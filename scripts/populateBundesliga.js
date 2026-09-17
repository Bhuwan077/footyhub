require('dotenv').config();
const pool = require('../db/db');

const API_BASE = 'https://api.football-data.org/v4';
const HEADERS = { 'X-Auth-Token': process.env.FOOTBALL_API_KEY };

async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function populateTeams() {
  console.log('Fetching Bundesliga teams...');
  const data = await fetchJSON(`${API_BASE}/competitions/BL1/teams`);

  for (const team of data.teams) {
    await pool.query(
      `INSERT INTO teams (name, country, logo_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING`,
      [team.name, team.area?.name || null, team.crest || null]
    );
  }
  console.log(`Processed ${data.teams.length} teams (shared teams table, duplicates skipped).`);
}

async function populateMatches() {
  console.log('Fetching Bundesliga matches...');
  const data = await fetchJSON(`${API_BASE}/competitions/BL1/matches`);

  const teamRows = await pool.query('SELECT id, name FROM teams');
  const teamIdByName = {};
  for (const row of teamRows.rows) {
    teamIdByName[row.name] = row.id;
  }

  let upserted = 0;
  for (const match of data.matches) {
    const homeId = teamIdByName[match.homeTeam.name];
    const awayId = teamIdByName[match.awayTeam.name];
    if (!homeId || !awayId) {
      console.log(`  Warning: missing team for match ${match.homeTeam.name} vs ${match.awayTeam.name}`);
      continue;
    }

    await pool.query(
      `INSERT INTO matches
        (api_match_id, home_team_id, away_team_id, stage, matchday, match_date, home_score, away_score, status, competition)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (api_match_id) DO UPDATE SET
         home_score = EXCLUDED.home_score,
         away_score = EXCLUDED.away_score,
         status = EXCLUDED.status,
         match_date = EXCLUDED.match_date`,
      [
        match.id,
        homeId,
        awayId,
        match.stage || 'REGULAR_SEASON',
        match.matchday || null,
        match.utcDate,
        match.score.fullTime.home,
        match.score.fullTime.away,
        match.status,
        'BUNDESLIGA'
      ]
    );
    upserted++;
  }
  console.log(`Upserted ${upserted} matches.`);
}

async function main() {
  try {
    await populateTeams();
    await populateMatches();
    console.log('Done.');
  } catch (err) {
    console.error('Error populating Bundesliga data:', err.message);
  } finally {
    await pool.end();
  }
}

main();