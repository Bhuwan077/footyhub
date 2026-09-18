// Dedicated ESPN-team-name -> teams-table matcher, used specifically for
// resolving team_id when populating player squads. This is DELIBERATELY
// separate from espnTeamAliases.js (which normalizes ESPN names to the
// shorter display strings used in match_events.team_name for goals/cards —
// a different target vocabulary entirely). Reusing that file here actively
// broke several matches (e.g. it mapped "Borussia Dortmund" -> "Dortmund",
// but the teams table row is actually named "Borussia Dortmund" in full —
// the alias made an already-correct match fail). Keep these two concerns
// separate.
//
// Follows the same three-tier approach already proven for Highlightly team
// matching in populatePlayers.js: exact match, explicit alias for genuine
// name variants, then normalized substring matching.

// ESPN names that are genuinely different words from the teams-table name
// (a language/spelling variant, or a short name ambiguous between two real
// clubs) rather than just a missing/extra suffix word.
// Key = ESPN's team.displayName, value = the EXACT teams.name to match.
const EXPLICIT_TEAM_MATCH_ALIASES = {
  'Bayern Munich': 'FC Bayern München',   // English vs German spelling
  'FC Cologne': '1. FC Köln',             // English vs German spelling
  'Deportivo': 'RC Deportivo La Coruña',  // "Deportivo" alone is ambiguous
                                          // with "Deportivo Alavés" — both
                                          // are real 2026/2027 La Liga clubs
  'Barcelona': 'FC Barcelona'             // "Barcelona" alone is ambiguous
                                          // with "RCD Espanyol de Barcelona"
};

// Suffix/prefix/filler words stripped before comparing — club-type
// abbreviations and generic words ("de", "la", "club"), not real identity.
const STRIP_WORDS = new Set([
  'fc', 'cf', 'sk', 'kv', 'ac', 'afc', 'ssc', 'as', 'sc', 'osc', 'fk', 'fa',
  'bc', 'cfc', 'acf', 'calcio', 'club', 'clube', 'rotterdam', 'portugal',
  'balompie', 'de', 'la', 'du', 'rc', 'rcd', 'cd', 'ud', 'us', 'ss', 'ca',
  'sv', 'tsg', 'fsv'
]);

function normalize(name) {
  const decomposed = name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip diacritics
  const tokens = decomposed
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => !/^\d+$/.test(t))       // drop pure-digit tokens (years, "04", etc.)
    .filter(t => !STRIP_WORDS.has(t));
  return tokens.join(' ');
}

// candidates: array of { id, name } — teams already scoped to the current
// competition. Returns { teamId, matchType } or { teamId: null, reason }.
function findTeamId(espnDisplayName, candidates) {
  // Tier 1: exact string match.
  const exact = candidates.find(c => c.name === espnDisplayName);
  if (exact) return { teamId: exact.id, matchType: 'exact' };

  // Tier 2: explicit alias for genuine name variants.
  const aliasTarget = EXPLICIT_TEAM_MATCH_ALIASES[espnDisplayName];
  if (aliasTarget) {
    const aliased = candidates.find(c => c.name === aliasTarget);
    if (aliased) return { teamId: aliased.id, matchType: 'alias' };
  }

  // Tier 3: normalized substring matching, either direction.
  const normEspn = normalize(espnDisplayName);
  const matches = candidates.filter(c => {
    const normDb = normalize(c.name);
    return normDb.includes(normEspn) || normEspn.includes(normDb);
  });

  if (matches.length === 1) {
    return { teamId: matches[0].id, matchType: 'fuzzy' };
  }
  if (matches.length > 1) {
    return {
      teamId: null,
      reason: `ambiguous — matched ${matches.length} teams: ${matches.map(m => m.name).join(', ')}`
    };
  }
  return { teamId: null, reason: 'no match found' };
}

module.exports = { findTeamId, EXPLICIT_TEAM_MATCH_ALIASES };