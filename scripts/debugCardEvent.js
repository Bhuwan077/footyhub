require('dotenv').config();

const BBS_BASE = 'https://api.bigballsdata.com/v1';
const HEADERS = { 'Authorization': `Bearer ${process.env.BIGBALLS_API_KEY}` };

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  const body = await res.json();
  return body;
}

async function main() {
  const matchesData = await fetchJSON(`${BBS_BASE}/matches?league=laliga&status=finished`);
  const matches = matchesData.data || [];
  console.log(`Got ${matches.length} finished matches.`);

  // Inspect the first 3 matches in full, raw.
  for (const match of matches.slice(0, 3)) {
    console.log(`\n=== Match ${match.id} (${match.home?.name} vs ${match.away?.name}) ===`);
    const eventsData = await fetchJSON(`${BBS_BASE}/matches/${match.id}/events`);
    console.log('RAW RESPONSE:');
    console.log(JSON.stringify(eventsData, null, 2));
  }
}

main();