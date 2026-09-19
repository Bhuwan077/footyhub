require('dotenv').config({ quiet: true });

const GOAL_API_BASE = 'https://api.goal-api.com/v1';
const API_KEY = process.env.GOAL_API_KEY;

// Known GOAL API league IDs from the existing goals/assists script.
// La Liga's isn't known yet — found by searching /leagues below.
const KNOWN_LEAGUE_IDS = {
  SERIEA: 'cmr77dvpd006yrx06zig7907g',
  BUNDESLIGA: 'cmr77dvgm0002rx06rt2uqxii'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function findLaLigaLeagueId() {
  console.log('Searching /leagues for La Liga...');
  const data = await fetchJSON('/leagues?limit=200');
  const leagues = data?.data || [];
  // La Liga is officially "LaLiga" in Spain — avoid grabbing a same-named
  // league from another country the way the earlier Serie A search had to
  // dodge a Brazilian "Serie A" duplicate.
  const candidates = leagues.filter(
    l => /la\s*liga/i.test(l.name || '') && /spain/i.test(l.countryName || '')
  );
  console.log(`  Found ${candidates.length} Spain-based match(es):`);
  for (const c of candidates) {
    console.log(`    id=${c.id}  name="${c.name}"  country=${c.countryName}`);
  }
  return candidates[0]?.id || null;
}

async function checkLeague(competition, leagueId) {
  console.log(`\n=== ${competition} (leagueId=${leagueId}) ===`);

  const teamsData = await fetchJSON(`/leagues/${leagueId}/teams`);
  const teams = teamsData?.data || [];
  console.log(`Teams returned: ${teams.length}`);
  if (teamsData?.pagination) {
    console.log(`  pagination: ${JSON.stringify(teamsData.pagination)}`);
  }
  if (teams.length === 0) return;

  // Check squads for the first 2 teams only — enough to check the response
  // shape and player ID quality without burning much quota.
  const sample = teams.slice(0, 2);
  for (const team of sample) {
    await sleep(400);
    console.log(`\n  -- Squad for ${team.name} (id=${team.id}) --`);
    const squadData = await fetchJSON(`/teams/${team.id}/players`);
    const players = squadData?.data || [];
    console.log(`  Players returned: ${players.length}`);
    if (squadData?.pagination) {
      console.log(`  pagination: ${JSON.stringify(squadData.pagination)}`);
    }
    if (players.length === 0) continue;

    const withId = players.filter(p => p.id != null).length;
    console.log(`  Players with a populated id: ${withId}/${players.length}`);

    // Print the raw shape of the first couple of players so we can see
    // exactly what fields are available (name, position, nationality,
    // jersey number, etc.) before writing the real population script.
    console.log('  Sample rows:');
    console.log(JSON.stringify(players.slice(0, 2), null, 2));
  }
}

async function main() {
  try {
    const laLigaId = await findLaLigaLeagueId();

    const leagues = { ...KNOWN_LEAGUE_IDS };
    if (laLigaId) leagues.LALIGA = laLigaId;
    else console.log('  !! Could not find La Liga — check manually.');

    for (const [competition, leagueId] of Object.entries(leagues)) {
      await checkLeague(competition, leagueId);
      await sleep(400);
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();