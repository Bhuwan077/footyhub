require('dotenv').config();

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };

async function main() {
  let offset = 0;
  const limit = 100;
  let all = [];

  while (true) {
    const res = await fetch(
      `${API_BASE}/matches?leagueId=2486&season=2026&limit=${limit}&offset=${offset}`,
      { headers: HEADERS }
    );
    const data = await res.json();
    const batch = data.data || data;

    all = all.concat(batch);
    console.log(`Fetched offset ${offset}: ${batch.length} matches (total so far: ${all.length})`);

    if (batch.length < limit) break;
    offset += limit;
    if (offset > 500) break;
  }

  const finished = all.filter(m => m.state?.description?.toLowerCase().includes('finish'));
  console.log(`\nTotal matches fetched: ${all.length}`);
  console.log(`Finished matches found: ${finished.length}`);

  for (const m of finished) {
    console.log(`${m.date} — ${m.homeTeam?.name} vs ${m.awayTeam?.name} — ${m.state?.description} — id: ${m.id}`);
  }
}

main();
