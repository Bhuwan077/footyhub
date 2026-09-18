// Shared ESPN team-name alias map, used by every script that pulls team
// names from ESPN's site API (site.api.espn.com) and needs them to match
// the names already stored in the `teams` table (sourced from
// football-data.org / GOAL API instead, which use different naming
// conventions for the same clubs).
//
// Originally built for populateCardsSerieABundesligaEspn.js after 8
// Bundesliga mismatches surfaced (Union Berlin, Dortmund, etc.).
// Centralized here so every ESPN-based script shares one list instead of
// drifting out of sync with each other.
//
// Key = ESPN's team.displayName, value = the name stored in `teams`.
// Extend this as more mismatches surface across any league — the players
// script below will log a warning for any team it can't match, which is
// how new entries get discovered.
const ESPN_TEAM_NAME_ALIASES = {
  // Bundesliga / Serie A (confirmed mismatches)
  'Internazionale': 'Inter',
  '1. FC Union Berlin': 'Union Berlin',
  'Borussia Mönchengladbach': 'B. Monchengladbach',
  'FC Augsburg': 'Augsburg',
  'TSG Hoffenheim': 'Hoffenheim',
  'Borussia Dortmund': 'Dortmund',
  'Hamburg SV': 'Hamburger SV',
  'SV Elversberg': 'Elversberg',
  'Schalke 04': 'Schalke'

  // La Liga: none confirmed yet. Add any found here once discovered.
};

function normalizeTeamName(name) {
  return ESPN_TEAM_NAME_ALIASES[name] || name;
}

module.exports = { ESPN_TEAM_NAME_ALIASES, normalizeTeamName };