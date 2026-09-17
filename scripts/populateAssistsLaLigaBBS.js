require('dotenv').config();
const pool = require('../db/db');

// Assists ONLY for La Liga. Goals and cards come from ESPN instead
// (populateGoalsCardsLaLigaEspn.js). Each assist is stored as its own 'Assist' event row
// with the ASSISTING player as the row's primary player/team — this is intentionally a
// distinct event_type from 'Goal', not attached to any goal row, so it never needs to be
// cross-referenced against ESPN's separately-sourced goal events.
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

// Column types were already widened to VARCHAR(64) for UUID support by the earlier BBS
// script's migration. Safe no-op if already correct.
async function ensureSchema() {
  await pool.query(`ALTER TABLE match_events ALTER COLUMN highlightly_match_id TYPE VARCHAR(64) USING highlightly_match_id::VARCHAR(64);`);
  await pool.query(`ALTER TABLE match_events ALTER COLUMN player_id TYPE VARCHAR(64) USING player_id::VARCHAR(64);`);
}

async function getFinishedMatches() {
  console.log('Fetching finished La Liga matches from Big Balls Sports Data...');
  const data = await fetchJSON(`${BBS_BASE}/matches?league=laliga&status=finished`);
  const matches = data.data || [];
  console.log(`Found ${matches.length} finished match(es).`);
  return matches;
}

// Tracks which match ids have already had their assists extracted, using a dedicated
// event_type ('Assist') so this check doesn't collide with ESPN's goal/card rows.
async function getAlreadyStoredMatchIds() {
  const result = await pool.query(
    `SELECT DISTINCT highlightly_match_id FROM match_events WHERE competition = $1 AND event_type = 'Assist'`,
    [COMPETITION]
  );
  return new Set(result.rows.map(r => r.highlightly_match_id));
}

function formatMatchTime(elapsed, elapsedExtra) {
  if (elapsed == null) return null;
  return elapsedExtra ? `${elapsed}+${elapsedExtra}` : String(elapsed);
}

async function storeAssistsForMatch(matchId) {
  const data = await fetchJSON(`${BBS_BASE}/matches/${matchId}/events`);
  const events = Array.isArray(data.data) ? data.data : [];
  if (events.length === 0) return 0;

  let inserted = 0;
  for (const ev of events) {
    if (!ev.assist_name) continue; // no assist on this goal (e.g. own goals, solo runs)

    await pool.query(
      `INSERT INTO match_events
        (highlightly_match_id, event_type, player_name, player_id, team_name,
         assisting_player_name, assisting_player_id, match_time, competition)
       VALUES ($1, 'Assist', $2, $3, $4, NULL, NULL, $5, $6)
       ON CONFLICT (highlightly_match_id, player_name, event_type, match_time) DO NOTHING`,
      [
        matchId,
        ev.assist_name,
        ev.assist_player_id || null,
        ev.team || null, // the assist happened for the same team as the goal
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

    let totalAssists = 0;
    for (const match of matches) {
      console.log(`Fetching assists for match ${match.id} (${match.home?.name} vs ${match.away?.name})...`);
      try {
        const count = await storeAssistsForMatch(match.id);
        totalAssists += count;
        console.log(`  -> ${count} assist(s) stored.`);
      } catch (err) {
        console.log(`  -> skipped due to error: ${err.message}`);
      }
      await sleep(300);
    }

    console.log(`Done. ${totalAssists} total assist(s) stored across ${matches.length} new match(es).`);
  } catch (err) {
    console.error('Error populating La Liga assists (Big Balls Sports Data):', err.message);
  } finally {
    await pool.end();
  }
}

main();