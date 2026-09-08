const express = require('express');
const router = express.Router();
const pool = require('../db/db');

router.get('/', async (req, res) => {
  try {
    const query = `
      WITH team_matches AS (
        SELECT home_team_id AS team_id, home_score AS goals_for, away_score AS goals_against
        FROM matches
        WHERE stage = 'LEAGUE_PHASE' AND status = 'FINISHED'
        UNION ALL
        SELECT away_team_id AS team_id, away_score AS goals_for, home_score AS goals_against
        FROM matches
        WHERE stage = 'LEAGUE_PHASE' AND status = 'FINISHED'
      )
      SELECT
        t.id,
        t.name,
        t.logo_url,
        COUNT(tm.team_id) AS played,
        SUM(CASE WHEN tm.goals_for > tm.goals_against THEN 1 ELSE 0 END) AS won,
        SUM(CASE WHEN tm.goals_for = tm.goals_against THEN 1 ELSE 0 END) AS drawn,
        SUM(CASE WHEN tm.goals_for < tm.goals_against THEN 1 ELSE 0 END) AS lost,
        COALESCE(SUM(tm.goals_for), 0) AS goals_for,
        COALESCE(SUM(tm.goals_against), 0) AS goals_against,
        COALESCE(SUM(tm.goals_for) - SUM(tm.goals_against), 0) AS goal_difference,
        COALESCE(SUM(
          CASE
            WHEN tm.goals_for > tm.goals_against THEN 3
            WHEN tm.goals_for = tm.goals_against THEN 1
            ELSE 0
          END
        ), 0) AS points
      FROM teams t
      LEFT JOIN team_matches tm ON tm.team_id = t.id
      GROUP BY t.id, t.name, t.logo_url
      ORDER BY points DESC, goal_difference DESC, goals_for DESC;
    `;

    const result = await pool.query(query);
    res.render('index', { standings: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading points table');
  }
});

module.exports = router;