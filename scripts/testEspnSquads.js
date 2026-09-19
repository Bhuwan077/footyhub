require('dotenv').config({ quiet: true });

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

const LEAGUES = {
  LALIGA: 'esp.1',
  SERIEA: 'ita.1',
  BUNDESLIGA: 'ger.1'
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.log(`  !! ${res.status} ${res.statusText} — ${path}`);
    return null;
  }
  return body;
}

async function checkLeague(competition, slug) {
  console.log(`\n=== ${competition} (${slug}) ===`);

  const teamsData = await fetchJSON(`${ESPN_BASE}/${slug}/teams`);
  const entries = teamsData?.sports?.[0]?.leagues?.[0]?.teams || [];
  console.log(`Teams returned: ${entries.length}`);

  if (entries.length === 0) return;

  // Check roster for the first 2 teams only.
  const sample = entries.slice(0, 2);
  for (const entry of sample) {
    const team = entry.team;
    await sleep(400);
    console.log(`\n  -- Roster for ${team.displayName} (id=${team.id}) --`);
    const rosterData = await fetchJSON(`${ESPN_BASE}/${slug}/teams/${team.id}/roster`);
    const athletes = rosterData?.athletes || rosterData?.team?.athletes || [];
    console.log(`  Players returned: ${Array.isArray(athletes) ? athletes.length : 'unexpected shape'}`);
    if (Array.isArray(athletes) && athletes.length > 0) {
      console.log('  Sample rows:');
      console.log(JSON.stringify(athletes.slice(0, 2), null, 2));
    } else {
      console.log('  Raw roster response keys:', Object.keys(rosterData || {}));
    }
  }
}

async function main() {
  for (const [comp, slug] of Object.entries(LEAGUES)) {
    await checkLeague(comp, slug);
    await sleep(400);
  }
}

main();