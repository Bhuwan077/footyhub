require('dotenv').config();

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };

const MATCH_ID = 1391940636; // Borussia Dortmund vs Villarreal

async function main() {
  const res = await fetch(`${API_BASE}/lineups/${MATCH_ID}`, { headers: HEADERS });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

main();