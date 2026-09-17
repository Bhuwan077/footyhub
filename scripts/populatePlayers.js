require('dotenv').config();
const pool = require('../db/db');

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };
const CL_LEAGUE_ID = 2486;
const SEASON = 2026;
const COMPETITION = 'UCL';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json();
}

async function getFinishedMatches() {
  let offset = 0;
  const limit = 100;
  let all = [];

  while (true) {
    const url = `${API_BASE}/matches?leagueId=${CL_LEAGUE_ID}&season=${SEASON}&limit=${limit}&offset=${offset}`;
    const data = await fetchJSON(url);
    const batch = data.data || data;
    all = all.concat(batch);
    if (batch.length < limit) break;
    offset += limit;
    if (offset > 500) break;
    await sleep(500);
  }

  return all.filter(m =>
    m.state?.description?.toLowerCase().includes('finish') &&
    m.round?.startsWith('League Stage')
  );
}

// Tracks which matches have already had their lineup fetched for squad population,
// so re-runs don't burn Highlightly quota re-fetching lineups we already processed.
// Created automatically if it doesn't exist yet — safe to run on every invocation.
async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_squad_matches (
      highlightly_match_id BIGINT NOT NULL,
      competition VARCHAR(10) NOT NULL,
      processed_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (highlightly_match_id, competition)
    );
  `);
}

async function getAlreadyProcessedMatchIds() {
  const result = await pool.query(
    `SELECT highlightly_match_id FROM processed_squad_matches WHERE competition = $1`,
    [COMPETITION]
  );
  return new Set(result.rows.map(r => String(r.highlightly_match_id)));
}

async function markProcessed(matchId) {
  await pool.query(
    `INSERT INTO processed_squad_matches (highlightly_match_id, competition)
     VALUES ($1, $2)
     ON CONFLICT (highlightly_match_id, competition) DO NOTHING`,
    [matchId, COMPETITION]
  );
}

// Keyed by the name HIGHLIGHTLY returns -> the name stored in our teams table.
// (Previously this was backwards, keyed by our DB name, so the lookup never matched.)
const TEAM_ALIASES = {
  'PAE AEK': 'AEK Athens FC',
  'Bayern Munich': 'FC Bayern München'
};

const SUFFIX_WORDS = /\b(fc|cf|sk|kv|ac|afc|ssc|as|sc|osc|1907|balompié|balompie|rotterdam|clube|club|de|portugal)\b/g;

function normalizeTeamName(name) {
  return name
    .normalize('NFD')               // decompose accented chars into base char + combining mark
    .replace(/[\u0300-\u036f]/g, '') // strip the combining marks (ç -> c, ü -> u, é -> e, etc.)
    .toLowerCase()
    .replace(SUFFIX_WORDS, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async function findTeamId(highlightlyName) {
  let result = await pool.query('SELECT id FROM teams WHERE name = $1', [highlightlyName]);
  if (result.rows.length > 0) return result.rows[0].id;

  if (TEAM_ALIASES[highlightlyName]) {
    result = await pool.query('SELECT id FROM teams WHERE name = $1', [TEAM_ALIASES[highlightlyName]]);
    if (result.rows.length > 0) return result.rows[0].id;
  }

  const allTeams = await pool.query('SELECT id, name FROM teams');
  const normalizedTarget = normalizeTeamName(highlightlyName);
  for (const team of allTeams.rows) {
    const normalizedDb = normalizeTeamName(team.name);
    if (normalizedDb.includes(normalizedTarget) || normalizedTarget.includes(normalizedDb)) {
      return team.id;
    }
  }

  return null;
}

function extractPlayers(teamData) {
  const players = [];
  const flatInitial = (teamData.initialLineup || []).flat();
  for (const p of [...flatInitial, ...(teamData.substitutes || [])]) {
    players.push({
      name: p.name,
      position: p.position,
      number: p.number,
      highlightlyId: p.id
    });
  }
  return players;
}

// Returns { stored, published }. published=false means Highlightly hasn't posted the
// lineup for this match yet — in that case the caller should NOT mark it processed,
// so it gets retried on a later run instead of being skipped forever.
async function storePlayersForMatch(matchId) {
  const lineup = await fetchJSON(`${API_BASE}/lineups/${matchId}`);
  if (!lineup.homeTeam || !lineup.awayTeam) return { stored: 0, published: false };

  let stored = 0;
  for (const teamData of [lineup.homeTeam, lineup.awayTeam]) {
    const teamId = await findTeamId(teamData.name);
    if (!teamId) {
      console.log(`  Warning: no matching team in DB for "${teamData.name}", skipping its players.`);
      continue;
    }
    const players = extractPlayers(teamData);

    for (const p of players) {
      await pool.query(
        `INSERT INTO players (team_id, name, position, highlightly_player_id, jersey_number)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (highlightly_player_id) DO UPDATE SET
           team_id = EXCLUDED.team_id,
           position = EXCLUDED.position,
           jersey_number = EXCLUDED.jersey_number`,
        [teamId, p.name, p.position, p.highlightlyId, p.number]
      );
      stored++;
    }
  }
  return { stored, published: true };
}

async function main() {
  try {
    await ensureTrackingTable();

    const finishedMatches = await getFinishedMatches();
    const alreadyProcessed = await getAlreadyProcessedMatchIds();

    const matches = finishedMatches.filter(m => !alreadyProcessed.has(String(m.id)));
    const skipped = finishedMatches.length - matches.length;

    console.log(`Found ${finishedMatches.length} finished League Phase matches.`);
    console.log(`Skipping ${skipped} already-processed matches. ${matches.length} to fetch.`);

    let total = 0;

    for (const match of matches) {
      console.log(`Fetching lineup for match ${match.id} (${match.homeTeam?.name} vs ${match.awayTeam?.name})...`);
      const { stored, published } = await storePlayersForMatch(match.id);
      total += stored;

      if (published) {
        await markProcessed(match.id);
        console.log(`  -> ${stored} players stored.`);
      } else {
        console.log(`  -> lineup not yet published, will retry next run.`);
      }

      await sleep(1500);
    }

    console.log(`Done. ${total} total player rows upserted.`);
  } catch (err) {
    console.error('Error populating players:', err.message);
  } finally {
    await pool.end();
  }
}

main();