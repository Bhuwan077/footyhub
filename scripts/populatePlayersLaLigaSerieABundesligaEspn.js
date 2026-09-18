require('dotenv').config({ quiet: true });
const pool = require('../db/db');
const { findTeamId } = require('./teamNameMatcher');

// ESPN's undocumented public site API — squads/rosters for La Liga, Serie A,
// and Bundesliga. Chosen over GOAL API's /teams/:id/players endpoint after
// testing found GOAL API's team lists inflated (season-bleed bug, same
// class already fixed on the goals/assists side). ESPN's team/roster counts
// came back correct with no season contamination.
//
// Team matching uses teamNameMatcher.js — NOT espnTeamAliases.js (that map
// targets a different vocabulary: the shorter names used in
// match_events.team_name for goals/cards display, not teams.name).
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

const LEAGUES = {
  LALIGA: { slug: 'esp.1' },
  SERIEA: { slug: 'ita.1' },
  BUNDESLIGA: { slug: 'ger.1' }
};

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

async function getEspnTeams(slug) {
  const data = await fetchJSON(`${ESPN_BASE}/${slug}/teams`);
  const entries = data?.sports?.[0]?.leagues?.[0]?.teams || [];
  return entries.map(e => e.team);
}

async function getRoster(slug, espnTeamId) {
  const data = await fetchJSON(`${ESPN_BASE}/${slug}/teams/${espnTeamId}/roster`);
  return data?.athletes || data?.team?.athletes || [];
}

// Teams scoped to this competition only — avoids any chance of matching
// against a similarly-named club from a different league.
async function getDbCandidates(competition) {
  const result = await pool.query(
    `SELECT DISTINCT t.id, t.name
     FROM teams t
     JOIN matches m ON t.id = m.home_team_id OR t.id = m.away_team_id
     WHERE m.competition = $1`,
    [competition]
  );
  return result.rows;
}

function parseJerseyNumber(jersey) {
  const n = parseInt(jersey, 10);
  return Number.isNaN(n) ? null : n;
}

async function upsertPlayer(teamId, athlete) {
  const espnPlayerId = athlete.id ? parseInt(athlete.id, 10) : null;
  if (!espnPlayerId) return false;

  const name = athlete.fullName || athlete.displayName || 'Unknown';
  const position = athlete.position?.name || null;
  const nationality = athlete.citizenship || null;
  const jerseyNumber = parseJerseyNumber(athlete.jersey);

  await pool.query(
    `INSERT INTO players (team_id, name, position, nationality, espn_player_id, jersey_number)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (espn_player_id) DO UPDATE SET
       team_id = EXCLUDED.team_id,
       name = EXCLUDED.name,
       position = EXCLUDED.position,
       nationality = EXCLUDED.nationality,
       jersey_number = EXCLUDED.jersey_number`,
    [teamId, name, position, nationality, espnPlayerId, jerseyNumber]
  );
  return true;
}

async function main() {
  try {
    for (const [competition, cfg] of Object.entries(LEAGUES)) {
      console.log(`\n=== ${competition} ===`);

      const espnTeams = await getEspnTeams(cfg.slug);
      const dbCandidates = await getDbCandidates(competition);
      console.log(`Found ${espnTeams.length} ESPN team(s), ${dbCandidates.length} DB team(s) for this competition.`);

      let totalPlayers = 0;
      let unmatchedTeams = 0;

      for (const team of espnTeams) {
        const { teamId, matchType, reason } = findTeamId(team.displayName, dbCandidates);

        if (!teamId) {
          console.log(`  !! "${team.displayName}" — ${reason}. Add to EXPLICIT_TEAM_MATCH_ALIASES in teamNameMatcher.js if this is a known club.`);
          unmatchedTeams++;
          continue;
        }

        await sleep(400);
        const roster = await getRoster(cfg.slug, team.id);

        let stored = 0;
        for (const athlete of roster) {
          const ok = await upsertPlayer(teamId, athlete);
          if (ok) stored++;
        }
        totalPlayers += stored;
        console.log(`  ${team.displayName} [${matchType}]: ${stored}/${roster.length} player(s) stored.`);
      }

      console.log(`${competition} done. ${totalPlayers} total player(s) stored across ${espnTeams.length - unmatchedTeams} team(s). ${unmatchedTeams} team(s) unmatched.`);
    }
  } catch (err) {
    console.error('Error populating La Liga/Serie A/Bundesliga players:', err.message);
  } finally {
    await pool.end();
  }
}

main();