require('dotenv').config();

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };

const datesToCheck = ['2026-09-09', '2026-09-10', '2026-09-11'];

async function main() {
  for (const date of datesToCheck) {
    const res = await fetch(
      `${API_BASE}/matches?leagueId=2486&season=2026&date=${date}&limit=50`,
      { headers: HEADERS }
    );
    const data = await res.json();
    const matches = data.data || data;

    console.log(`\n--- ${date}: ${matches.length} matches ---`);
    for (const m of matches) {
      console.log(`${m.homeTeam?.name} vs ${m.awayTeam?.name} — ${m.state?.description}`);
    }
  }
}

main();