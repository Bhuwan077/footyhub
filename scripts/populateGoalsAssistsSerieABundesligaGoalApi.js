require('dotenv').config({ quiet: true });
const pool = require('../db/db');

// GOAL API (goal-api.com) — goals + assists for Serie A and Bundesliga.
// Cards are NOT available on this endpoint (confirmed empty across 16 test
// matches) — those come from populateCardsSerieABundesligaEspn.js instead.
//
// IMPORTANT: /v1/results?date=X&leagueId=Y does NOT appear to filter by date
// (confirmed via testing — identical event counts returned across different
// requested dates). So this script tracks progress by MATCH ID instead of by
// date, same pattern as populatePlayers.js's processed_squad_matches table —
// fetch the league's full finished-match list once, only process match IDs
// not already in the tracking table.
const GOAL_API_BASE = 'https://api.goal-api.com/v1';
const API_KEY = process.env.GOAL_API_KEY;

const LEAGUES = {
  SERIEA: { goalApiLeagueId: 'cmr77dvpd006yrx06zig7907g' },
  BUNDESLIGA: { goalApiLeagueId: 'cmr77dvgm0002rx06rt2uqxii' }
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(path) {
  const res = await fetch(`${GOAL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` }
  });
  if (!res.ok) {
    throw new Error(`GOAL API request failed: ${res.status} ${res.statusText} — ${path}`);
  }
  return res.json();
}

async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_goalapi_matches (
      match_id VARCHAR(64) NOT NULL,
      competition VARCHAR(10) NOT NULL,
      processed_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (match_id, competition)
    );
  `);
}

async function getAlreadyProcessedMatchIds(competition) {
  const result = await pool.query(
    `SELECT match_id FROM processed_goalapi_matches WHERE competition = $1`,
    [competition]
  );
  return new Set(result.rows.map(r => r.match_id));
}

async function markMatchProcessed(matchId, competition) {
  await pool.query(
    `INSERT INTO processed_goalapi_matches (match_id, competition) VALUES ($1, $2)
     ON CONFLICT (match_id, competition) DO NOTHING`,
    [matchId, competition]
  );
}

// Fetch ALL finished matches for a league in one go, rather than looping
// dates — since date filtering isn't reliable, requesting once and filtering
// client-side by matchStatus is both correct and far cheaper on quota.
async function getFinishedMatches(leagueId) {
  const data = await fetchJSON(`/results?leagueId=${leagueId}`);
  const matches = data?.data || [];
  return matches.filter(m => m.matchStatus === 'FINISHED');
}

function normalizeEventType(rawType) {
  const map = {
    GOAL: 'Goal',
    PENALTY: 'Penalty',
    PENALTY_GOAL: 'Penalty',
    OWN_GOAL: 'Own Goal'
  };
  return map[rawType] || null;
}

async function storeEventsForFixture(fixtureId, competition, homeTeamName, awayTeamName) {
  const data = await fetchJSON(`/fixtures/${fixtureId}/events`);
  const events = data?.data || [];
  let newRows = 0;

  for (const ev of events) {
    const eventType = normalizeEventType(ev.type);
    if (!eventType) continue;

    const isHome = !!(ev.homeScorer || ev.homeScorerId);
    const scorerName = isHome ? ev.homeScorer : ev.awayScorer;
    const scorerId = isHome ? ev.homeScorerId : ev.awayScorerId;
    const assistName = isHome ? ev.homeAssist : ev.awayAssist;
    const assistId = isHome ? ev.homeAssistId : ev.awayAssistId;
    const teamName = isHome ? homeTeamName : awayTeamName;

    if (!scorerName) continue;

    const result = await pool.query(
      `INSERT INTO match_events
        (highlightly_match_id, event_type, player_name, player_id, team_name,
         assisting_player_name, assisting_player_id, match_time, competition)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        `goalapi-${fixtureId}`,
        eventType,
        scorerName,
        scorerId || null,
        teamName,
        assistName || null,
        assistId || null,
        ev.time || null,
        competition
      ]
    );
    if (result.rowCount > 0) newRows++;
  }
  return newRows;
}

async function main() {
  try {
    await ensureTrackingTable();

    for (const [competition, cfg] of Object.entries(LEAGUES)) {
      console.log(`\n=== ${competition} ===`);

      const finishedMatches = await getFinishedMatches(cfg.goalApiLeagueId);
      const processedIds = await getAlreadyProcessedMatchIds(competition);
      const newMatches = finishedMatches.filter(m => !processedIds.has(m.id));

      console.log(`Found ${finishedMatches.length} finished match(es) total. ${newMatches.length} new (not yet processed).`);

      let totalNewEvents = 0;
      for (const match of newMatches) {
        const newRows = await storeEventsForFixture(
          match.id,
          competition,
          match.homeTeamName,
          match.awayTeamName
        );
        totalNewEvents += newRows;
        console.log(`  ${match.homeTeamName} vs ${match.awayTeamName}: ${newRows} new event(s).`);

        await markMatchProcessed(match.id, competition);
        await sleep(600);
      }
      console.log(`${competition} done. ${totalNewEvents} total new event(s) stored across ${newMatches.length} match(es).`);
    }
  } catch (err) {
    console.error('Error populating Serie A/Bundesliga goals+assists:', err.message);
  } finally {
    await pool.end();
  }
}

main();