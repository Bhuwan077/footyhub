require('dotenv').config();
const pool = require('../db/db');

const API_BASE = 'https://v3.football.api-sports.io';
const HEADERS = { 'x-apisports-key': process.env.APIFOOTBALL_KEY };
const LALIGA_LEAGUE_ID = 140;
const SEASON = 2026;
const COMPETITION = 'LALIGA';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText} — ${url}`);
  }
  const data = await res.json();

  // API-Football sometimes returns HTTP 200 with a populated "errors" field
  // instead of a non-200 status (e.g. when a quota is exceeded), so check it explicitly.
  if (data.errors && (Array.isArray(data.errors) ? data.errors.length > 0 : Object.keys(data.errors).length > 0)) {
    throw new Error(`API returned errors: ${JSON.stringify(data.errors)} — ${url}`);
  }

  return data;
}

// Adds the assisting_player_id column if it doesn't already exist. API-Football gives us a
// real assist player ID (unlike Highlightly, which only gives a name string), so we can group
// La Liga assists cleanly the same way goals are already grouped by player_id. Safe to run on
// every invocation.
async function ensureSchema() {
  await pool.query(`ALTER TABLE match_events ADD COLUMN IF NOT EXISTS assisting_player_id BIGINT;`);
}

async function getFinishedMatches() {
  console.log('Fetching La Liga fixtures from API-Football...');
  const url = `${API_BASE}/fixtures?league=${LALIGA_LEAGUE_ID}&season=${SEASON}`;
  const data = await fetchJSON(url);
  const all = data.response || [];

  const finished = all.filter(f => f.fixture?.status?.short === 'FT');
  console.log(`Found ${finished.length} finished matches out of ${all.length} total.`);
  return finished;
}

// Returns the set of fixture ids that already have at least one event row stored for LALIGA.
// A match's events are fetched in a single API call (storeEventsForMatch), so "has any row"
// reliably means "already fully processed" — safe to skip re-fetching it from API-Football.
async function getAlreadyStoredMatchIds() {
  const result = await pool.query(
    `SELECT DISTINCT highlightly_match_id FROM match_events WHERE competition = $1`,
    [COMPETITION]
  );
  return new Set(result.rows.map(r => String(r.highlightly_match_id)));
}

// API-Football reports goals/cards with a coarse "type" (Goal, Card, subst) plus a "detail"
// field with the specifics. This maps that pair to the event_type strings the rest of the app
// (routes/football.js stats queries) already expects. Returns null for events that shouldn't
// be stored as scoring/disciplinary events at all (e.g. a missed penalty).
function normalizeEventType(type, detail) {
  if (type === 'Goal') {
    if (detail === 'Missed Penalty') return null;
    if (detail === 'Penalty') return 'Penalty';
    if (detail === 'Own Goal') return 'Own Goal';
    return 'Goal';
  }
  if (type === 'Card') {
    if (detail === 'Red Card') return 'Red Card';
    // A second yellow results in a sending-off, so it's treated as a Red Card for
    // disciplinary stats purposes rather than double-counting as a Yellow Card too.
    if (detail === 'Second Yellow card') return 'Red Card';
    return 'Yellow Card';
  }
  if (type === 'subst' || type === 'Subst') return 'Substitution';
  return type;
}

function formatMatchTime(time) {
  if (!time) return null;
  return time.extra ? `${time.elapsed}+${time.extra}` : String(time.elapsed);
}

async function storeEventsForMatch(fixtureId) {
  const data = await fetchJSON(`${API_BASE}/fixtures/events?fixture=${fixtureId}`);
  const events = data.response || [];
  if (events.length === 0) return 0;

  let inserted = 0;
  for (const ev of events) {
    const eventType = normalizeEventType(ev.type, ev.detail);
    if (!eventType) continue;

    await pool.query(
      `INSERT INTO match_events
        (highlightly_match_id, event_type, player_name, player_id, team_name,
         assisting_player_name, assisting_player_id, match_time, competition)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (highlightly_match_id, player_name, event_type, match_time) DO NOTHING`,
      [
        fixtureId,
        eventType,
        ev.player?.name || 'Unknown',
        ev.player?.id || null,
        ev.team?.name || null,
        ev.assist?.name || null,
        ev.assist?.id || null,
        formatMatchTime(ev.time),
        COMPETITION
      ]
    );
    inserted++;
  }
  return inserted;
}

async function main() {
  try {
    await ensureSchema();

    const finishedMatches = await getFinishedMatches();
    const alreadyStored = await getAlreadyStoredMatchIds();

    const matches = finishedMatches.filter(m => !alreadyStored.has(String(m.fixture.id)));
    const skipped = finishedMatches.length - matches.length;
    console.log(`Skipping ${skipped} already-stored matches. ${matches.length} new match(es) to fetch.`);

    let totalEvents = 0;

    for (const match of matches) {
      const fixtureId = match.fixture.id;
      const homeName = match.teams?.home?.name;
      const awayName = match.teams?.away?.name;
      console.log(`Fetching events for match ${fixtureId} (${homeName} vs ${awayName})...`);
      const count = await storeEventsForMatch(fixtureId);
      totalEvents += count;
      console.log(`  -> ${count} events stored.`);
      await sleep(1500);
    }

    console.log(`Done. ${totalEvents} total events stored across ${matches.length} new match(es).`);
  } catch (err) {
    console.error('Error populating La Liga events:', err.message);
  } finally {
    await pool.end();
  }
}

main();