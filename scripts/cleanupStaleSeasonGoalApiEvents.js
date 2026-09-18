require('dotenv').config({ quiet: true });
const pool = require('../db/db');

// One-time cleanup: deletes match_events rows that were inserted by
// populateGoalsAssistsSerieABundesligaGoalApi.js before it filtered by
// season, so they came from a prior (stale) season instead of the current
// one. Safe to re-run — matches nothing once cleaned.
//
// Usage:
//   node scripts/cleanupStaleSeasonGoalApiEvents.js            (preview only)
//   node scripts/cleanupStaleSeasonGoalApiEvents.js --apply    (actually delete)
const GOAL_API_BASE = 'https://api.goal-api.com/v1';
const API_KEY = process.env.GOAL_API_KEY;
const APPLY = process.argv.includes('--apply');

const LEAGUES = {
  SERIEA: { goalApiLeagueId: 'cmr77dvpd006yrx06zig7907g' },
  BUNDESLIGA: { goalApiLeagueId: 'cmr77dvgm0002rx06rt2uqxii' }
};

function getCurrentSeasonString(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
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

async function main() {
  const currentSeason = getCurrentSeasonString();
  console.log(`Current season: ${currentSeason}`);
  console.log(APPLY ? 'Mode: APPLY (will delete rows)' : 'Mode: PREVIEW (no changes)');

  for (const [competition, cfg] of Object.entries(LEAGUES)) {
    console.log(`\n=== ${competition} ===`);

    const data = await fetchJSON(`/results?leagueId=${cfg.goalApiLeagueId}`);
    const matches = data?.data || [];
    const staleIds = matches
      .filter(m => m.leagueYear && m.leagueYear !== currentSeason)
      .map(m => `goalapi-${m.id}`);

    console.log(`${matches.length} total fixtures returned, ${staleIds.length} from a stale season.`);

    if (staleIds.length === 0) {
      console.log('Nothing to clean up.');
      continue;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM match_events
       WHERE competition = $1 AND highlightly_match_id = ANY($2)`,
      [competition, staleIds]
    );
    console.log(`${countResult.rows[0].count} stored event row(s) match these stale fixtures.`);

    if (APPLY) {
      const deleteResult = await pool.query(
        `DELETE FROM match_events
         WHERE competition = $1 AND highlightly_match_id = ANY($2)`,
        [competition, staleIds]
      );
      console.log(`Deleted ${deleteResult.rowCount} row(s).`);
    } else {
      console.log('Preview only — rerun with --apply to actually delete.');
    }
  }

  await pool.end();
}

main();