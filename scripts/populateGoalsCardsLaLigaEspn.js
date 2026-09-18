require('dotenv').config();
const pool = require('../db/db');
const { normalizeTeamName } = require('./espnTeamAliases');

// ESPN's undocumented public site API — no API key needed. This script handles GOALS
// and CARDS for La Liga. Assists come from Big Balls Sports Data instead
// (populateAssistsLaLigaBBS.js), stored as their own 'Assist' event type — so goals/cards
// and assists never need to be cross-referenced against each other's match-id systems.
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1';
const COMPETITION = 'LALIGA';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ESPN request failed: ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json();
}

function toYYYYMMDD(isoDate) {
  return isoDate.slice(0, 10).replace(/-/g, '');
}

async function getSeasonDates() {
  const data = await fetchJSON(`${ESPN_BASE}/scoreboard`);
  const calendar = data.leagues?.[0]?.calendar || [];
  const dates = [...new Set(calendar.map(toYYYYMMDD))];
  console.log(`Found ${dates.length} matchday date(s) in the season calendar.`);
  return dates;
}

async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_goals_cards_dates (
      date_str VARCHAR(8) NOT NULL,
      competition VARCHAR(10) NOT NULL,
      processed_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (date_str, competition)
    );
  `);
}

async function getAlreadyProcessedDates() {
  const result = await pool.query(
    `SELECT date_str FROM processed_goals_cards_dates WHERE competition = $1`,
    [COMPETITION]
  );
  return new Set(result.rows.map(r => r.date_str));
}

async function markDateProcessed(dateStr) {
  await pool.query(
    `INSERT INTO processed_goals_cards_dates (date_str, competition) VALUES ($1, $2)
     ON CONFLICT (date_str, competition) DO NOTHING`,
    [dateStr, COMPETITION]
  );
}

function normalizeEventType(detail) {
  if (detail.ownGoal) return 'Own Goal';
  if (detail.penaltyKick) return 'Penalty';
  if (detail.scoringPlay) return 'Goal';
  if (detail.redCard) return 'Red Card';
  if (detail.yellowCard) return 'Yellow Card';
  return null;
}

async function storeEventsForDate(dateStr) {
  const data = await fetchJSON(`${ESPN_BASE}/scoreboard?dates=${dateStr}`);
  const events = data.events || [];

  let inserted = 0;
  let hadCompletedMatch = false;

  for (const event of events) {
    const competition = event.competitions?.[0];
    if (!competition?.status?.type?.completed) continue;
    hadCompletedMatch = true;

    const teamNames = {};
    for (const c of competition.competitors || []) {
      teamNames[c.team.id] = normalizeTeamName(c.team.displayName);
    }

    for (const detail of competition.details || []) {
      const eventType = normalizeEventType(detail);
      if (!eventType) continue;

      const player = detail.athletesInvolved?.[0];
      if (!player) continue;

      await pool.query(
        `INSERT INTO match_events
          (highlightly_match_id, event_type, player_name, player_id, team_name,
           assisting_player_name, assisting_player_id, match_time, competition)
         VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7)
         ON CONFLICT (highlightly_match_id, player_name, event_type, match_time) DO NOTHING`,
        [
          `espn-${event.id}`,
          eventType,
          player.displayName || 'Unknown',
          player.id || null,
          teamNames[detail.team?.id] || null,
          detail.clock?.displayValue || null,
          COMPETITION
        ]
      );
      inserted++;
    }
  }
  return { inserted, hadCompletedMatch };
}

async function main() {
  try {
    await ensureTrackingTable();

    const allDates = await getSeasonDates();
    const alreadyProcessed = await getAlreadyProcessedDates();
    const datesToFetch = allDates.filter(d => !alreadyProcessed.has(d));

    console.log(`Skipping ${allDates.length - datesToFetch.length} already-processed date(s). ${datesToFetch.length} to fetch.`);

    let totalEvents = 0;
    let skippedFuture = 0;
    for (const dateStr of datesToFetch) {
      const { inserted, hadCompletedMatch } = await storeEventsForDate(dateStr);
      totalEvents += inserted;

      if (hadCompletedMatch) {
        console.log(`  ${dateStr}: ${inserted} event(s) stored.`);
        await markDateProcessed(dateStr);
      } else {
        console.log(`  ${dateStr}: no finished matches yet, will recheck next run.`);
        skippedFuture++;
      }
      await sleep(500);
    }

    console.log(`Done. ${totalEvents} total event(s) stored. ${skippedFuture} date(s) not yet played, left unmarked for a future run.`);
  } catch (err) {
    console.error('Error populating La Liga goals/cards:', err.message);
  } finally {
    await pool.end();
  }
}

main();