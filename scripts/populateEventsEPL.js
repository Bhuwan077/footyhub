require('dotenv').config();
const pool = require('../db/db');

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };
const EPL_LEAGUE_ID = 33973;
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
  console.log('Fetching Premier League matches from Highlightly...');
  let offset = 0;
  const limit = 100;
  let all = [];

  while (true) {
    const url = `${API_BASE}/matches?leagueId=${EPL_LEAGUE_ID}&season=${SEASON}&limit=${limit}&offset=${offset}`;
    const data = await fetchJSON(url);
    const batch = data.data || data;
    all = all.concat(batch);
    if (batch.length < limit) break;
    offset += limit;
    if (offset > 500) break;
    await sleep(500);
  }

  const finished = all.filter(m => m.state?.description?.toLowerCase().includes('finish'));
  console.log(`Found ${finished.length} finished matches out of ${all.length} total.`);
  return finished;
}

// Returns the set of highlightly_match_id values that already have at least one
// event row stored for EPL. A match's events are fetched in a single API call
// (storeEventsForMatch), so "has any row" reliably means "already fully processed" —
// safe to skip re-fetching it from Highlightly.
async function getAlreadyStoredMatchIds() {
  const result = await pool.query(
    `SELECT DISTINCT highlightly_match_id FROM match_events WHERE competition = $1`,
    ['EPL']
  );
  return new Set(result.rows.map(r => String(r.highlightly_match_id)));
}

async function storeEventsForMatch(matchId) {
  const events = await fetchJSON(`${API_BASE}/events/${matchId}`);
  if (!Array.isArray(events) || events.length === 0) return 0;

  let inserted = 0;
  for (const ev of events) {
    // ON CONFLICT targets the same COALESCE(player_id, name) expression as the
    // match_events_dedup_idx unique index — this treats "F. Torres" and
    // "Ferrán Torres" as the same event when they share a player_id, so a
    // re-run that gets a different name format from Highlightly can't insert
    // a duplicate goal/card/substitution row for the same match_time.
    await pool.query(
      `INSERT INTO match_events
        (highlightly_match_id, event_type, player_name, player_id, team_name, assisting_player_name, assisting_player_id, match_time, competition)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (highlightly_match_id, (COALESCE(player_id::text, TRIM(player_name))), event_type, match_time) DO NOTHING`,
      [
        matchId,
        ev.type || null,
        ev.player || 'Unknown',
        ev.playerId || null,
        ev.team?.name || null,
        ev.assist || null,
        ev.assistingPlayerId || null,
        ev.time || null,
        'EPL'
      ]
    );
    inserted++;
  }
  return inserted;
}

async function main() {
  try {
    const finishedMatches = await getFinishedMatches();
    const alreadyStored = await getAlreadyStoredMatchIds();

    const matches = finishedMatches.filter(m => !alreadyStored.has(String(m.id)));
    const skipped = finishedMatches.length - matches.length;
    console.log(`Skipping ${skipped} already-stored matches. ${matches.length} new match(es) to fetch.`);

    let totalEvents = 0;

    for (const match of matches) {
      console.log(`Fetching events for match ${match.id} (${match.homeTeam?.name} vs ${match.awayTeam?.name})...`);
      const count = await storeEventsForMatch(match.id);
      totalEvents += count;
      console.log(`  -> ${count} events stored.`);
      await sleep(1500);
    }

    console.log(`Done. ${totalEvents} total events stored across ${matches.length} new match(es).`);
  } catch (err) {
    console.error('Error populating EPL events:', err.message);
  } finally {
    await pool.end();
  }
}

main();