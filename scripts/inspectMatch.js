require('dotenv').config();

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };

async function main() {
  const res = await fetch(`${API_BASE}/matches?leagueId=2486&season=2026&limit=100`, { headers: HEADERS });
  const data = await res.json();
  const matches = data.data || data;

  console.log('First match object:');
  console.log(JSON.stringify(matches[0], null, 2));
}

main();