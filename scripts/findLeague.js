require('dotenv').config();

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };

async function main() {
  const res = await fetch(`${API_BASE}/leagues?limit=100`, { headers: HEADERS });
  const data = await res.json();

  const leagues = data.data || data;
  console.log(`Total leagues returned: ${leagues.length}`);

  const matches = leagues.filter(l =>
    l.name && l.name.toLowerCase().includes('champions')
  );

  console.log('Matches for "champions":');
  console.log(JSON.stringify(matches, null, 2));
}

main();