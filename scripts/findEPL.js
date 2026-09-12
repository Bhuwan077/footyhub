require('dotenv').config();

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };

async function main() {
  const res = await fetch(`${API_BASE}/leagues?limit=100`, { headers: HEADERS });
  const data = await res.json();
  const leagues = data.data || data;

  const matches = leagues.filter(l =>
    l.name && l.name.toLowerCase().includes('premier league')
  );

  console.log(JSON.stringify(matches, null, 2));
}

main();