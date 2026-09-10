require('dotenv').config();
const pool = require('../db/db');

const API_BASE = 'https://soccer.highlightly.net';
const HEADERS = { 'x-rapidapi-key': process.env.HIGHLIGHTLY_API_KEY };

async function fetchLineup(highlightlyMatchId) {
  const res = await fetch(`${API_BASE}/lineups/${highlightlyMatchId}`, { headers: HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.homeTeam || !data.awayTeam) return null;
  return data;
}

async function syncLineups() {
  const candidates = await pool.query(`
    SELECT m.id, m.highlightly_match_id, ht.name AS home_name, at.name AS away_name
    FROM matches m
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    LEFT JOIN match_lineups ml ON ml.match_id = m.id
    WHERE ml.id IS NULL
      AND m.highlightly_match_id IS NOT NULL
      AND m.match_date <= NOW() + INTERVAL '1 hour'
    ORDER BY m.match_date ASC
    LIMIT 20;
  `);

  if (candidates.rows.length === 0) {
    console.log('No matches currently need a lineup sync.');
    return;
  }

  let stored = 0;
  for (const match of candidates.rows) {
    const lineup = await fetchLineup(match.highlightly_match_id);
    if (!lineup) {
      console.log(`Lineup not yet available for: ${match.home_name} vs ${match.away_name}`);
      continue;
    }

    await pool.query(
      `INSERT INTO match_lineups
        (match_id, home_formation, home_initial_lineup, home_substitutes,
         away_formation, away_initial_lineup, away_substitutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (match_id) DO UPDATE SET
         home_formation = EXCLUDED.home_formation,
         home_initial_lineup = EXCLUDED.home_initial_lineup,
         home_substitutes = EXCLUDED.home_substitutes,
         away_formation = EXCLUDED.away_formation,
         away_initial_lineup = EXCLUDED.away_initial_lineup,
         away_substitutes = EXCLUDED.away_substitutes,
         fetched_at = NOW()`,
      [
        match.id,
        lineup.homeTeam.formation || null,
        JSON.stringify(lineup.homeTeam.initialLineup || []),
        JSON.stringify(lineup.homeTeam.substitutes || []),
        lineup.awayTeam.formation || null,
        JSON.stringify(lineup.awayTeam.initialLineup || []),
        JSON.stringify(lineup.awayTeam.substitutes || [])
      ]
    );
    stored++;
    console.log(`Stored lineup for: ${match.home_name} vs ${match.away_name}`);
  }

  console.log(`Lineup sync done. ${stored} lineups stored this run.`);
}

module.exports = syncLineups;

if (require.main === module) {
  syncLineups()
    .then(() => pool.end())
    .catch(err => {
      console.error('Error syncing lineups:', err.message);
      pool.end();
    });
}