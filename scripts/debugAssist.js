require('dotenv').config();

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };

// A finished EPL match ID we already know has goals with assists (from earlier logs).
const MATCH_ID = 1325349886;

async function main() {
  const res = await fetch(`${API_BASE}/events/${MATCH_ID}`, { headers: HEADERS });
  if (!res.ok) {
    console.error(`Request failed: ${res.status} ${res.statusText}`);
    return;
  }
  const events = await res.json();

  const withAssist = events.find(ev => ev.assist);
  if (!withAssist) {
    console.log('No event with an assist found in this match. Full first event for reference:');
    console.log(JSON.stringify(events[0], null, 2));
    return;
  }

  console.log('Event with an assist:');
  console.log(JSON.stringify(withAssist, null, 2));
}

main();