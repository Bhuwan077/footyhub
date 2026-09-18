// One-off test script — GOAL API coverage check, round 3:
// 1. Scan several finished matches per league until we find one with a
//    non-GOAL event (card, sub, etc.) to confirm the events schema for cards.
// 2. Log response headers on every call to check for rate-limit info.
// Run: node scripts/testGoalApiCoverage.js
require('dotenv').config({ quiet: true });

const API_KEY = process.env.GOAL_API_KEY;
const BASE_URL = 'https://api.goal-api.com/v1';

const REAL_LEAGUES = {
  serieA: 'cmr77dvpd006yrx06zig7907g',
  bundesliga: 'cmr77dvgm0002rx06rt2uqxii'
};

if (!API_KEY) {
  console.error('Missing GOAL_API_KEY in .env');
  process.exit(1);
}

let callCount = 0;

async function get(path) {
  callCount++;
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` }
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }

  const rateLimitHeaders = {};
  for (const [key, value] of res.headers.entries()) {
    if (/rate.?limit|remaining|retry.?after/i.test(key)) {
      rateLimitHeaders[key] = value;
    }
  }
  if (Object.keys(rateLimitHeaders).length > 0) {
    console.log(`  [call #${callCount}] rate-limit headers:`, rateLimitHeaders);
  }

  return { status: res.status, ok: res.ok, body };
}

function getRecentDates(daysBack = 15) {
  const dates = [];
  const today = new Date();
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function findMatchesWithCards(leagueId, leagueLabel, maxMatchesToCheck = 8) {
  console.log(`\n--- Scanning ${leagueLabel} for a match with a card event ---`);
  const dates = getRecentDates();
  let checked = 0;

  for (const date of dates) {
    if (checked >= maxMatchesToCheck) break;
    const res = await get(`/results?date=${date}&leagueId=${leagueId}`);
    if (!res.ok) continue;

    const matches = (res.body?.data || []).filter(m => m.matchStatus === 'FINISHED');

    for (const match of matches) {
      if (checked >= maxMatchesToCheck) break;
      checked++;

      const evRes = await get(`/fixtures/${match.id}/events`);
      if (!evRes.ok) continue;

      const events = evRes.body?.data || [];
      const types = [...new Set(events.map(e => e.type))];
      console.log(`  ${match.homeTeamName} vs ${match.awayTeamName} (${date}): types = [${types.join(', ')}]`);

      const cardEvent = events.find(e => e.type && e.type.includes('CARD'));
      if (cardEvent) {
        console.log(`  ✅ Found a card event:`, JSON.stringify(cardEvent, null, 2));
        return;
      }
    }
  }
  console.log(`  ⚠️  No card event found after checking ${checked} matches.`);
}

(async () => {
  for (const [key, leagueId] of Object.entries(REAL_LEAGUES)) {
    await findMatchesWithCards(leagueId, key);
  }
  console.log(`\nTotal API calls made this run: ${callCount}`);
})();