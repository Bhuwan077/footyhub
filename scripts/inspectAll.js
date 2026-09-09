require('dotenv').config();

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };

async function main() {
  const res = await fetch(`${API_BASE}/matches?leagueId=2486&season=2026&limit=100`, { headers: HEADERS });
  const data = await res.json();
  const matches = data.data || data;

  console.log(`Total matches: ${matches.length}`);

  const counts = {};
  for (const m of matches) {
    const desc = m.state?.description || 'UNKNOWN';
    counts[desc] = (counts[desc] || 0) + 1;
  }
  console.log('State description counts:');
  console.log(counts);

  const finishedLike = matches.find(m => m.state?.description?.toLowerCase().includes('finish'));
  if (finishedLike) {
    console.log('Example finished match:');
    console.log(JSON.stringify(finishedLike, null, 2));
  } else {
    console.log('No finished-looking matches found in this batch.');
    const dates = matches.map(m => m.date).sort();
    console.log('Earliest date in batch:', dates[0]);
    console.log('Latest date in batch:', dates[dates.length - 1]);
  }
}

main();