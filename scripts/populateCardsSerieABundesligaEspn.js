require('dotenv').config({ quiet: true });
const pool = require('../db/db');

// ESPN's undocumented public site API — cards ONLY for Serie A and Bundesliga.
// Goals+assists come from GOAL API instead (populateGoalsAssistsSerieABundesligaGoalApi.js),
// stored under a completely separate id prefix (goalapi-...) so the two
// providers' events never collide or need cross-referencing — same
// independent-provider pattern used for La Liga (BBS assists vs ESPN goals+cards),
// just split the other way around here since GOAL API already covers goals+assists.
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

const LEAGUES = {
  SERIEA: { slug: 'ita.1' },
  BUNDESLIGA: { slug: 'ger.1' }
};

// ESPN's team.displayName sometimes differs from the name used elsewhere
// (football-data.org / GOAL API) for the same club — ESPN tends to use
// fuller official names, German clubs especially (e.g. "Borussia Dortmund"
// vs "Dortmund", "1. FC Union Berlin" vs "Union Berlin"). Normalized here so
// team_name is consistent across goals/assists/cards on the stats page.
// Extend this as more mismatches surface.
const ESPN_TEAM_NAME_ALIASES = {
  'Internazionale': 'Inter',
  '1. FC Union Berlin': 'Union Berlin',
  'Borussia Mönchengladbach': 'B. Monchengladbach',
  'FC Augsburg': 'Augsburg',
  'TSG Hoffenheim': 'Hoffenheim',
  'Borussia Dortmund': 'Dortmund',
  'Hamburg SV': 'Hamburger SV',
  'SV Elversberg': 'Elversberg',
  'Schalke 04': 'Schalke'
};

function normalizeTeamName(name) {
  return ESPN_TEAM_NAME_ALIASES[name] || name;
}

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

async function getSeasonDates(slug) {
  const data = await fetchJSON(`${ESPN_BASE}/${slug}/scoreboard`);
  const calendar = data.leagues?.[0]?.calendar || [];
  return [...new Set(calendar.map(toYYYYMMDD))];
}

async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_cards_dates (
      date_str VARCHAR(8) NOT NULL,
      competition VARCHAR(10) NOT NULL,
      processed_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (date_str, competition)
    );
  `);
}

async function getAlreadyProcessedDates(competition) {
  const result = await pool.query(
    `SELECT date_str FROM processed_cards_dates WHERE competition = $1`,
    [competition]
  );
  return new Set(result.rows.map(r => r.date_str));
}

async function markDateProcessed(dateStr, competition) {
  await pool.query(
    `INSERT INTO processed_cards_dates (date_str, competition) VALUES ($1, $2)
     ON CONFLICT (date_str, competition) DO NOTHING`,
    [dateStr, competition]
  );
}

// Cards only — goal-related flags (scoringPlay/ownGoal/penaltyKick) are
// intentionally ignored here since GOAL API already covers those.
function normalizeCardType(detail) {
  if (detail.redCard) return 'Red Card';
  if (detail.yellowCard) return 'Yellow Card';
  return null;
}

async function storeCardsForDate(slug, dateStr, competition) {
  const data = await fetchJSON(`${ESPN_BASE}/${slug}/scoreboard?dates=${dateStr}`);
  const events = data.events || [];

  let inserted = 0;
  let hadCompletedMatch = false;

  for (const event of events) {
    const competitionObj = event.competitions?.[0];
    if (!competitionObj?.status?.type?.completed) continue;
    hadCompletedMatch = true;

    const teamNames = {};
    for (const c of competitionObj.competitors || []) {
      teamNames[c.team.id] = normalizeTeamName(c.team.displayName);
    }

    for (const detail of competitionObj.details || []) {
      const cardType = normalizeCardType(detail);
      if (!cardType) continue;

      const player = detail.athletesInvolved?.[0];
      if (!player) continue;

      await pool.query(
        `INSERT INTO match_events
          (highlightly_match_id, event_type, player_name, player_id, team_name,
           assisting_player_name, assisting_player_id, match_time, competition)
         VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7)
         ON CONFLICT DO NOTHING`,
        [
          `espn-card-${event.id}`,
          cardType,
          player.displayName || 'Unknown',
          player.id || null,
          teamNames[detail.team?.id] || null,
          detail.clock?.displayValue || null,
          competition
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

    for (const [competition, cfg] of Object.entries(LEAGUES)) {
      console.log(`\n=== ${competition} ===`);
      const allDates = await getSeasonDates(cfg.slug);
      const processed = await getAlreadyProcessedDates(competition);
      const toFetch = allDates.filter(d => !processed.has(d));

      console.log(`Skipping ${allDates.length - toFetch.length} already-processed date(s). ${toFetch.length} to fetch.`);

      let totalCards = 0;
      for (const dateStr of toFetch) {
        const { inserted, hadCompletedMatch } = await storeCardsForDate(cfg.slug, dateStr, competition);
        totalCards += inserted;

        if (hadCompletedMatch) {
          console.log(`  ${dateStr}: ${inserted} card(s) stored.`);
          await markDateProcessed(dateStr, competition);
        } else {
          console.log(`  ${dateStr}: no finished matches yet, will recheck next run.`);
        }
        await sleep(400);
      }
      console.log(`${competition} done. ${totalCards} total card(s) stored.`);
    }
  } catch (err) {
    console.error('Error populating Serie A/Bundesliga cards:', err.message);
  } finally {
    await pool.end();
  }
}

main();