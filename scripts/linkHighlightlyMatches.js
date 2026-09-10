require('dotenv').config();
const pool = require('../db/db');

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };
const CL_LEAGUE_ID = 2486;
const SEASON = 2026;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function getAllHighlightlyMatches() {
  let offset = 0;
  const limit = 100;
  let all = [];
  while (true) {
    const data = await fetchJSON(`${API_BASE}/matches?leagueId=${CL_LEAGUE_ID}&season=${SEASON}&limit=${limit}&offset=${offset}`);
    const batch = data.data || data;
    all = all.concat(batch);
    if (batch.length < limit) break;
    offset += limit;
    if (offset > 500) break;
    await sleep(500);
  }
  return all.filter(m => m.round?.startsWith('League Stage'));
}

const TEAM_ALIASES = {
  'PAE AEK': 'AEK Athens FC',
  'FC Bayern München': 'Bayern Munich'
};

const SUFFIX_WORDS = /\b(fc|cf|sk|kv|ac|afc|ssc|as|sc|osc|fk|fa|1907|balompié|balompie|rotterdam|clube|club|de|portugal)\b/g;

function normalize(name) {
  const deaccented = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return deaccented.toLowerCase().replace(SUFFIX_WORDS, '').replace(/[^a-z0-9]/g, '').trim();
}

function namesMatch(ourName, hlName) {
  if (TEAM_ALIASES[ourName] && normalize(TEAM_ALIASES[ourName]) === normalize(hlName)) return true;
  const na = normalize(ourName);
  const nb = normalize(hlName);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function daysApart(dateStrA, dateStrB) {
  const diff = Math.abs(new Date(dateStrA) - new Date(dateStrB));
  return diff / (1000 * 60 * 60 * 24);
}

async function main() {
  try {
    const hlMatches = await getAllHighlightlyMatches();
    console.log(`Fetched ${hlMatches.length} League Phase matches from Highlightly.`);

    const ourMatches = await pool.query(`
      SELECT m.id, m.match_date, ht.name AS home_name, at.name AS away_name
      FROM matches m
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
      WHERE m.highlightly_match_id IS NULL
      ORDER BY m.match_date ASC;
    `);
    console.log(`${ourMatches.rows.length} of our matches still need linking.`);

    let linked = 0;
    for (const ours of ourMatches.rows) {
      const ourDate = new Date(ours.match_date).toISOString().slice(0, 10);

      const match = hlMatches.find(hl => {
        const hlDate = hl.date?.slice(0, 10);
        const dateOk = daysApart(ourDate, hlDate) <= 1;
        const homeOk = namesMatch(ours.home_name, hl.homeTeam?.name || '');
        const awayOk = namesMatch(ours.away_name, hl.awayTeam?.name || '');
        return dateOk && homeOk && awayOk;
      });

      if (match) {
        await pool.query('UPDATE matches SET highlightly_match_id = $1 WHERE id = $2', [match.id, ours.id]);
        linked++;
        console.log(`Linked: ${ours.home_name} vs ${ours.away_name} -> Highlightly id ${match.id}`);
      } else {
        console.log(`No match found for: ${ours.home_name} vs ${ours.away_name} (${ourDate})`);
      }
    }

    console.log(`Done. ${linked} matches linked.`);
  } catch (err) {
    console.error('Error linking matches:', err.message);
  } finally {
    await pool.end();
  }
}

main();