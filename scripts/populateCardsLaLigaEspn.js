require('dotenv').config();
const pool = require('../db/db');

// ESPN's undocumented public site API — no API key needed. This script is intentionally
// scoped to CARDS ONLY. Goals and assists for La Liga come from Big Balls Sports Data
// (populateEventsLaLigaBBS.js) instead — keeping one source per event type means the two
// providers' different match-id systems (BBS: UUIDs, ESPN: numeric) never need to be
// cross-referenced against each other. Stats are aggregated by event_type independently,
// so rows from both sources can coexist in match_events without any conflict.
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

// Separate tracking table from the old populateEventsLaLigaEspn.js's processed_event_dates,
// so this cards-only script has its own independent "already done" state.
async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_card_dates (
      date_str VARCHAR(8) NOT NULL,
      competition VARCHAR(10) NOT NULL,
      processed_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (date_str, competition)
    );
  `);
}

async function getAlreadyProcessedDates() {
  const result = await pool.query(
    `SELECT date_str FROM processed_card_dates WHERE competition = $1`,
    [COMPETITION]
  );
  return new Set(result.rows.map(r => r.date_str));
}

async function markDateProcessed(dateStr) {
  await pool.query(
    `INSERT INTO processed_card_dates (date_str, competition) VALUES ($1, $2)
     ON CONFLICT (date_str, competition) DO NOTHING`,
    [dateStr, COMPETITION]
  );
}

// Only returns 'Yellow Card' or 'Red Card' — goals are deliberately ignored here since
// BBS already provides them. Confirmed live in an earlier test against this same API.
function normalizeCardType(detail) {
  if (detail.redCard) return 'Red Card';
  if (detail.yellowCard) return 'Yellow Card';
  return null;
}

async function storeCardsForDate(dateStr) {
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
      teamNames[c.team.id] = c.team.displayName;
    }

    for (const detail of competition.details || []) {
      const eventType = normalizeCardType(detail);
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
          `espn-${event.id}`, // prefixed so it can never collide with a BBS UUID or numeric id
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

    let totalCards = 0;
    let skippedFuture = 0;
    for (const dateStr of datesToFetch) {
      const { inserted, hadCompletedMatch } = await storeCardsForDate(dateStr);
      totalCards += inserted;

      if (hadCompletedMatch) {
        console.log(`  ${dateStr}: ${inserted} card(s) stored.`);
        await markDateProcessed(dateStr);
      } else {
        console.log(`  ${dateStr}: no finished matches yet, will recheck next run.`);
        skippedFuture++;
      }
      await sleep(500);
    }

    console.log(`Done. ${totalCards} total card(s) stored. ${skippedFuture} date(s) not yet played, left unmarked for a future run.`);
  } catch (err) {
    console.error('Error populating La Liga cards:', err.message);
  } finally {
    await pool.end();
  }
}

main();