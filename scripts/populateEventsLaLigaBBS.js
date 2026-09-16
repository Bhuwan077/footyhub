require('dotenv').config();
const pool = require('../db/db');

const BBS_BASE = 'https://api.bigballsdata.com/v1';
const HEADERS = { 'Authorization': `Bearer ${process.env.BIGBALLS_API_KEY}` };
const COMPETITION = 'LALIGA';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Big Balls Sports Data request failed: ${res.status} ${res.statusText} — ${url}`);
  }
  const body = await res.json();
  if (body.error) {
    throw new Error(`API returned an error: ${JSON.stringify(body.error)} — ${url}`);
  }
  return body;
}

// Three migrations, all safe to run every time:
// 1. highlightly_match_id needs to hold UUID strings (Big Balls' match ids), not just the
//    BIGINT-sized numeric ids from Highlightly/API-Football/ESPN, so widen it to VARCHAR.
// 2. player_id has the same problem — Highlightly/ESPN gave numeric ids, Big Balls gives UUIDs.
// 3. assisting_player_id was created as BIGINT by the earlier ESPN-era script. A plain
//    "ADD COLUMN IF NOT EXISTS ... VARCHAR" is a no-op once the column already exists, so it
//    silently stays BIGINT — this must be an explicit ALTER COLUMN TYPE, not an ADD COLUMN.
// All three use USING ...::VARCHAR(64) so existing numeric values convert cleanly.
async function ensureSchema() {
  await pool.query(`ALTER TABLE match_events ALTER COLUMN highlightly_match_id TYPE VARCHAR(64) USING highlightly_match_id::VARCHAR(64);`);
  await pool.query(`ALTER TABLE match_events ALTER COLUMN player_id TYPE VARCHAR(64) USING player_id::VARCHAR(64);`);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'match_events' AND column_name = 'assisting_player_id'
      ) THEN
        ALTER TABLE match_events ALTER COLUMN assisting_player_id TYPE VARCHAR(64) USING assisting_player_id::VARCHAR(64);
      ELSE
        ALTER TABLE match_events ADD COLUMN assisting_player_id VARCHAR(64);
      END IF;
    END $$;
  `);
}

async function getFinishedMatches() {
  console.log('Fetching finished La Liga matches from Big Balls Sports Data...');
  const data = await fetchJSON(`${BBS_BASE}/matches?league=laliga&status=finished`);
  const matches = data.data || [];
  console.log(`Found ${matches.length} finished match(es).`);
  return matches;
}

// Returns the set of match ids that already have at least one event row stored for LALIGA.
// A match's events are fetched in a single API call, so "has any row" reliably means
// "already fully processed" — safe to skip re-fetching it.
async function getAlreadyStoredMatchIds() {
  const result = await pool.query(
    `SELECT DISTINCT highlightly_match_id FROM match_events WHERE competition = $1`,
    [COMPETITION]
  );
  return new Set(result.rows.map(r => r.highlightly_match_id));
}

// Maps this API's event_type/event_detail pair to the event_type strings the rest of the
// app expects. Only "Goal" (with detail "Normal Goal"/"Own Goal") has been confirmed live;
// the Card branch is written defensively but UNTESTED — verify against a real match that
// had a card before trusting card counts.
function normalizeEventType(eventType, eventDetail) {
  if (eventType === 'Goal') {
    if (eventDetail === 'Own Goal') return 'Own Goal';
    if (eventDetail === 'Penalty' || eventDetail === 'Penalty Goal') return 'Penalty';
    return 'Goal';
  }
  if (eventType === 'Card' || eventType === 'Yellow Card' || eventType === 'Red Card') {
    if (eventType === 'Red Card' || eventDetail === 'Red Card') return 'Red Card';
    return 'Yellow Card';
  }
  return null; // substitutions etc. — not stored
}

function formatMatchTime(elapsed, elapsedExtra) {
  if (elapsed == null) return null;
  return elapsedExtra ? `${elapsed}+${elapsedExtra}` : String(elapsed);
}

async function storeEventsForMatch(matchId) {
  const data = await fetchJSON(`${BBS_BASE}/matches/${matchId}/events`);
  const events = Array.isArray(data.data) ? data.data : [];
  if (events.length === 0) return 0;

  let inserted = 0;
  for (const ev of events) {
    const eventType = normalizeEventType(ev.event_type, ev.event_detail);
    if (!eventType) continue;

    await pool.query(
      `INSERT INTO match_events
        (highlightly_match_id, event_type, player_name, player_id, team_name,
         assisting_player_name, assisting_player_id, match_time, competition)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (highlightly_match_id, player_name, event_type, match_time) DO NOTHING`,
      [
        matchId,
        eventType,
        ev.player_name || 'Unknown',
        ev.player_id || null,
        ev.team || null,
        ev.assist_name || null,
        ev.assist_player_id || null,
        formatMatchTime(ev.elapsed, ev.elapsed_extra),
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

    const matches = finishedMatches.filter(m => !alreadyStored.has(m.id));
    const skipped = finishedMatches.length - matches.length;
    console.log(`Skipping ${skipped} already-stored match(es). ${matches.length} new to fetch.`);

    let totalEvents = 0;
    for (const match of matches) {
      console.log(`Fetching events for match ${match.id} (${match.home?.name} vs ${match.away?.name})...`);
      try {
        const count = await storeEventsForMatch(match.id);
        totalEvents += count;
        console.log(`  -> ${count} events stored.`);
      } catch (err) {
        console.log(`  -> skipped due to error: ${err.message}`);
      }
      await sleep(300);
    }

    console.log(`Done. ${totalEvents} total events stored across ${matches.length} new match(es).`);
  } catch (err) {
    console.error('Error populating La Liga events (Big Balls Sports Data):', err.message);
  } finally {
    await pool.end();
  }
}

main();