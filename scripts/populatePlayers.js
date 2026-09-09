require('dotenv').config();
const pool = require('../db/db');

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };
const CL_LEAGUE_ID = 2486;
const SEASON = 2026;

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

const TEAM_ALIASES = {
  'AEK Athens FC': 'PAE AEK'
};

const SUFFIX_WORDS = /\b(fc|cf|sk|kv|ac|afc|ssc|as|sc|osc|1907|balompié|balompie|rotterdam|clube|club|de|portugal)\b/g;

function normalizeTeamName(name) {
  return name
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

async function storePlayersForMatch(matchId) {
  const lineup = await fetchJSON(`${API_BASE}/lineups/${matchId}`);
  if (!lineup.homeTeam || !lineup.awayTeam) return 0;

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
  return stored;
}

async function main() {
  try {
    const matches = await getFinishedMatches();
    console.log(`Found ${matches.length} finished League Phase matches.`);
    let total = 0;

    for (const match of matches) {
      console.log(`Fetching lineup for match ${match.id} (${match.homeTeam?.name} vs ${match.awayTeam?.name})...`);
      const count = await storePlayersForMatch(match.id);
      total += count;
      console.log(`  -> ${count} players stored.`);
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