require('dotenv').config();
const pool = require('../db/db');

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };
const EPL_LEAGUE_ID = 33973;
const SEASON = 2026;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json();
}

async function getFinishedMatches() {
  console.log('Fetching Premier League matches from Highlightly...');
  let offset = 0;
  const limit = 100;
  let all = [];

  while (true) {
    const url = `${API_BASE}/matches?leagueId=${EPL_LEAGUE_ID}&season=${SEASON}&limit=${limit}&offset=${offset}`;
    const data = await fetchJSON(url);
    const batch = data.data || data;
    all = all.concat(batch);
    if (batch.length < limit) break;
    offset += limit;
    if (offset > 500) break;
    await sleep(500);
  }

  const finished = all.filter(m => m.state?.description?.toLowerCase().includes('finish'));
  console.log(`Found ${finished.length} finished matches out of ${all.length} total.`);
  return finished;
}

async function storeEventsForMatch(matchId) {
  const events = await fetchJSON(`${API_BASE}/events/${matchId}`);
  if (!Array.isArray(events) || events.length === 0) return 0;

  let inserted = 0;
  for (const ev of events) {
    await pool.query(
      `INSERT INTO match_events
        (highlightly_match_id, event_type, player_name, player_id, team_name, assisting_player_name, match_time, competition)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (highlightly_match_id, player_name, event_type, match_time) DO NOTHING`,
      [
        matchId,
        ev.type || null,
        ev.player || 'Unknown',
        ev.playerId || null,
        ev.team?.name || null,
        ev.assist || null,
        ev.time || null,
        'EPL'
      ]
    );
    inserted++;
  }
  return inserted;
}

async function main() {
  try {
    const matches = await getFinishedMatches();
    let totalEvents = 0;

    for (const match of matches) {
      console.log(`Fetching events for match ${match.id} (${match.homeTeam?.name} vs ${match.awayTeam?.name})...`);
      const count = await storeEventsForMatch(match.id);
      totalEvents += count;
      console.log(`  -> ${count} events stored.`);
      await sleep(1500);
    }

    console.log(`Done. ${totalEvents} total events stored across ${matches.length} matches.`);
  } catch (err) {
    console.error('Error populating EPL events:', err.message);
  } finally {
    await pool.end();
  }
}

main();