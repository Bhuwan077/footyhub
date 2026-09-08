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
  console.log('Fetching Champions League teams...');
  const data = await fetchJSON(`${API_BASE}/competitions/CL/teams`);

  for (const team of data.teams) {
    await pool.query(
      `INSERT INTO teams (name, country, logo_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING`,
      [team.name, team.area?.name || null, team.crest || null]
    );
  }
  console.log(`Inserted ${data.teams.length} teams.`);
}

async function populateMatches() {
  console.log('Fetching Champions League matches...');
  const data = await fetchJSON(`${API_BASE}/competitions/CL/matches`);

  const teamRows = await pool.query('SELECT id, name FROM teams');
  const teamIdByName = {};
  for (const row of teamRows.rows) {
    teamIdByName[row.name] = row.id;
  }

  let inserted = 0;
  for (const match of data.matches) {
    const homeId = teamIdByName[match.homeTeam.name];
    const awayId = teamIdByName[match.awayTeam.name];
    if (!homeId || !awayId) continue;

    const stage = match.stage === 'LEAGUE_STAGE' ? 'LEAGUE_PHASE' : match.stage;

    await pool.query(
      `INSERT INTO matches
        (home_team_id, away_team_id, stage, matchday, match_date, home_score, away_score, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        homeId,
        awayId,
        stage,
        match.matchday || null,
        match.utcDate,
        match.score.fullTime.home,
        match.score.fullTime.away,
        match.status
      ]
    );
    inserted++;
  }
  console.log(`Inserted ${inserted} matches.`);
}

async function main() {
  try {
    await populateTeams();
    await populateMatches();
    console.log('Done.');
  } catch (err) {
    console.error('Error populating database:', err.message);
  } finally {
    await pool.end();
  }
}

main();