require('dotenv').config();

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };

async function main() {
  const res = await fetch(
    `${API_BASE}/matches?leagueId=2486&season=2026&date=2026-09-08&limit=50`,
    { headers: HEADERS }
  );
  const data = await res.json();
  const matches = data.data || data;

  console.log(`Matches on 2026-09-08: ${matches.length}`);
  for (const m of matches) {
    console.log(`Round: "${m.round}" | Home: "${m.homeTeam?.name}" | Away: "${m.awayTeam?.name}" | Date: ${m.date}`);
  }
}

main();