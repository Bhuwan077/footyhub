require('dotenv').config({ quiet: true });

const GOAL_API_BASE = 'https://api.goal-api.com/v1';
const API_KEY = process.env.GOAL_API_KEY;

const LEAGUES = {
  SERIEA: 'cmr77dvpd006yrx06zig7907g',
  BUNDESLIGA: 'cmr77dvgm0002rx06rt2uqxii'
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(path) {
  const res = await fetch(`${GOAL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` }
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.log(`  !! ${res.status} ${res.statusText} — ${path}`);
    return null;
  }
  return body;
}

async function findLaLiga() {
  console.log('Searching /leagues for La Liga (paginated, no limit override)...');
  let offset = 0;
  const found = [];
  while (true) {
    const data = await fetchJSON(`/leagues?offset=${offset}`);
    if (!data) break;
    const leagues = data.data || [];
    for (const l of leagues) {
      if (/la\s*liga/i.test(l.name || '') && /spain/i.test(l.countryName || '')) {
        found.push(l);
      }
    }
    if (!data.pagination?.hasMore) break;
    offset += leagues.length || 50;
    await sleep(300);
  }
  for (const c of found) console.log(`  id=${c.id}  name="${c.name}"  country=${c.countryName}`);
  return found[0]?.id || null;
}

async function checkTeamsForDuplicates(competition, leagueId) {
  console.log(`\n=== ${competition}: full team list ===`);
  const data = await fetchJSON(`/leagues/${leagueId}/teams`);
  const teams = data?.data || [];
  console.log(`Total returned: ${teams.length}`);

  const byName = {};
  for (const t of teams) {
    byName[t.name] = byName[t.name] || [];
    byName[t.name].push(t.id);
  }
  const names = Object.keys(byName);
  console.log(`Distinct team names: ${names.length}`);
  const dupes = names.filter(n => byName[n].length > 1);
  if (dupes.length > 0) {
    console.log(`Duplicate names found (${dupes.length}):`);
    for (const n of dupes) console.log(`  "${n}": ${JSON.stringify(byName[n])}`);
  } else {
    console.log('No duplicate names — team count itself is inflated some other way (check IDs/seasons individually).');
  }
  return teams;
}

async function checkIsActiveFilter(teamId, teamName) {
  await sleep(300);
  const data = await fetchJSON(`/teams/${teamId}/players`);
  const players = data?.data || [];
  const active = players.filter(p => p.isActive === true);
  const inactive = players.filter(p => p.isActive !== true);
  console.log(`\n  ${teamName}: ${players.length} total, ${active.length} isActive=true, ${inactive.length} not.`);
  if (inactive.length > 0) {
    console.log(`  Inactive sample: ${inactive.slice(0, 5).map(p => p.name).join(', ')}`);
  }
}

async function main() {
  const laLigaId = await findLaLiga();
  if (laLigaId) console.log(`\nLa Liga leagueId: ${laLigaId}`);

  for (const [comp, id] of Object.entries(LEAGUES)) {
    const teams = await checkTeamsForDuplicates(comp, id);
    // Check isActive filter on the two teams we already sampled, to compare
    await checkIsActiveFilter(teams[0]?.id, teams[0]?.name);
    if (teams[1]) await checkIsActiveFilter(teams[1].id, teams[1].name);
    await sleep(300);
  }
}

main();