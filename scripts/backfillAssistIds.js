// scripts/backfillAssistIds.js
// One-off backfill: fills in assisting_player_id on old match_events rows that only
// have assisting_player_name (from before assistingPlayerId capture was added).
//
// Matches by LAST NAME within the same team's players table (populated by
// populatePlayers.js / populatePlayersEPL.js, which already has real highlightly_player_id
// values). Only accepts a match when exactly one player on that team shares the last name
// — anything ambiguous (zero matches, or more than one) is skipped and printed for manual
// review, never guessed.
//
// A small set of manual overrides (MANUAL_NAME_OVERRIDES) handles specific assist names
// that don't reduce to a matchable last name automatically (transliteration differences,
// nicknames, stray characters, or genuinely ambiguous last-name collisions) — found during
// the preview runs.
//
// A matched player with no highlightly_player_id (a known players-table bug — e.g. the
// "Isaque" duplicate-row case) is treated as unmatched rather than silently writing NULL.
//
// PREVIEW MODE (default): only prints what WOULD be updated. No writes happen.
// Run with `node scripts/backfillAssistIds.js --apply` to actually perform the UPDATEs.

require('dotenv').config();
const pool = require('../db/db');

const APPLY = process.argv.includes('--apply');

// Same fuzzy team-name matching used in populatePlayers.js / populatePlayersEPL.js,
// since match_events.team_name isn't guaranteed to be an exact string match to teams.name.
const TEAM_ALIASES = {
  'Man City': 'Manchester City FC',
  'Man Utd': 'Manchester United FC',
  'Spurs': 'Tottenham Hotspur FC',
  "Nott'm Forest": 'Nottingham Forest FC',
  'Bournemouth': 'AFC Bournemouth',
  'PAE AEK': 'AEK Athens FC',
  'Bayern Munich': 'FC Bayern München'
};

// Manual overrides for assist names that don't reduce to a matchable last name
// automatically — found during the preview runs' "no player match" / "ambiguous" lists.
// Keyed by the exact assisting_player_name string as stored in match_events.
const MANUAL_NAME_OVERRIDES = {
  'Yehor Yarmoliuk': 'Y. Yarmolyuk',       // transliteration difference
  'Chema Andrés': 'José María Andrés Baixauli', // nickname; matched by full squad name instead of last-name
  'Jan Virgili Tenas': 'Jan Virgili',      // assist record has an extra surname token
  'Murillo Santiago': 'Murillo',           // single-name player in squad vs. fuller assist name
  'Tigran·Barseghyan': 'T. Barseghyan',    // stray middle-dot character instead of a space
  'Lautaro Martínez': 'Lautaro Martínez'   // ambiguous last-name match (Josep Martínez, a GK, also shares the surname); pin to the correct player explicitly
};

const SUFFIX_WORDS = /\b(fc|cf|sk|kv|ac|afc|ssc|as|sc|osc|fk|fa|1907|balompié|balompie|rotterdam|clube|club|de|portugal)\b/g;

function normalizeTeamName(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(SUFFIX_WORDS, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s.-]/g, '')
    .trim();
}

// Last token of a normalized name, treated as the "last name" for matching purposes.
// Good enough for single/double-barrelled Western names; flagged cases get manual review.
function lastNameOf(fullName) {
  const parts = normalizeName(fullName).split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

async function findTeamId(eventTeamName, allTeams) {
  let exact = allTeams.find(t => t.name === eventTeamName);
  if (exact) return exact.id;

  if (TEAM_ALIASES[eventTeamName]) {
    const aliased = allTeams.find(t => t.name === TEAM_ALIASES[eventTeamName]);
    if (aliased) return aliased.id;
  }

  const normalizedTarget = normalizeTeamName(eventTeamName);
  for (const t of allTeams) {
    const normalizedDb = normalizeTeamName(t.name);
    if (normalizedDb.includes(normalizedTarget) || normalizedTarget.includes(normalizedDb)) {
      return t.id;
    }
  }
  return null;
}

async function main() {
  console.log(APPLY ? 'Running in APPLY mode — this WILL update the database.' : 'Running in PREVIEW mode — no changes will be made.');

  const allTeams = (await pool.query('SELECT id, name FROM teams')).rows;

  const rowsToFix = (await pool.query(`
    SELECT id, assisting_player_name, team_name, competition, highlightly_match_id, event_type, match_time
    FROM match_events
    WHERE event_type = 'Goal'
      AND assisting_player_name IS NOT NULL
      AND assisting_player_id IS NULL
    ORDER BY team_name, assisting_player_name
  `)).rows;

  console.log(`Found ${rowsToFix.length} assist rows missing assisting_player_id.\n`);

  let matched = 0;
  let skippedNoTeam = 0;
  let skippedNoPlayer = 0;
  let skippedAmbiguous = 0;

  const playersByTeam = new Map(); // team_id -> players[]

  for (const row of rowsToFix) {
    const teamId = await findTeamId(row.team_name, allTeams);
    if (!teamId) {
      console.log(`SKIP (no team match): "${row.assisting_player_name}" / team_name="${row.team_name}"`);
      skippedNoTeam++;
      continue;
    }

    if (!playersByTeam.has(teamId)) {
      const players = (await pool.query(
        'SELECT id, name, highlightly_player_id FROM players WHERE team_id = $1',
        [teamId]
      )).rows;
      playersByTeam.set(teamId, players);
    }
    const squad = playersByTeam.get(teamId);

    let candidates;
    if (MANUAL_NAME_OVERRIDES[row.assisting_player_name]) {
      const overrideName = MANUAL_NAME_OVERRIDES[row.assisting_player_name];
      candidates = squad.filter(p => p.name === overrideName);
    } else {
      const targetLastName = lastNameOf(row.assisting_player_name);
      candidates = squad.filter(p => lastNameOf(p.name) === targetLastName);
    }

    if (candidates.length === 0) {
      console.log(`SKIP (no player match): "${row.assisting_player_name}" (team_name="${row.team_name}")`);
      skippedNoPlayer++;
      continue;
    }
    if (candidates.length > 1) {
      const names = candidates.map(c => c.name).join(' | ');
      console.log(`SKIP (ambiguous, ${candidates.length} candidates): "${row.assisting_player_name}" -> ${names}`);
      skippedAmbiguous++;
      continue;
    }

    const player = candidates[0];

    if (!player.highlightly_player_id) {
      console.log(`SKIP (matched player has no highlightly_player_id): "${row.assisting_player_name}" -> "${player.name}" — needs the players-table bug fixed first`);
      skippedNoPlayer++;
      continue;
    }

    console.log(`MATCH: "${row.assisting_player_name}" -> "${player.name}" (highlightly_player_id=${player.highlightly_player_id})`);
    matched++;

    if (APPLY) {
      await pool.query(
        'UPDATE match_events SET assisting_player_id = $1 WHERE id = $2',
        [player.highlightly_player_id, row.id]
      );
    }
  }

  console.log(`\nSummary: ${matched} matched${APPLY ? ' and updated' : ' (preview only, not written)'}, ${skippedNoTeam} skipped (no team), ${skippedNoPlayer} skipped (no player), ${skippedAmbiguous} skipped (ambiguous).`);
}

main()
  .catch(err => console.error('Error:', err.message))
  .finally(() => pool.end());