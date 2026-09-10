const express = require('express');
const router = express.Router();
const pool = require('../db/db');

router.get('/matches', async (req, res) => {
  try {
    const query = `
      SELECT
        m.id, m.match_date, m.stage, m.matchday, m.status,
        m.home_score, m.away_score,
        ht.name AS home_team, ht.logo_url AS home_logo,
        at.name AS away_team, at.logo_url AS away_logo
      FROM matches m
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
      ORDER BY m.match_date ASC;
    `;
    const result = await pool.query(query);

    const live = result.rows.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED');
    const upcoming = result.rows.filter(m => m.status !== 'FINISHED' && m.status !== 'IN_PLAY' && m.status !== 'PAUSED');
    const finished = result.rows.filter(m => m.status === 'FINISHED').reverse();

    res.json({ live, upcoming, finished });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load matches' });
  }
});

router.get('/standings', async (req, res) => {
  try {
    const query = `
      WITH team_matches AS (
        SELECT home_team_id AS team_id, home_score AS goals_for, away_score AS goals_against
        FROM matches
        WHERE stage = 'LEAGUE_PHASE' AND status IN ('FINISHED', 'IN_PLAY', 'PAUSED')
        UNION ALL
        SELECT away_team_id AS team_id, away_score AS goals_for, home_score AS goals_against
        FROM matches
        WHERE stage = 'LEAGUE_PHASE' AND status IN ('FINISHED', 'IN_PLAY', 'PAUSED')
      )
      SELECT
        t.id, t.name, t.logo_url,
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
    res.json({ standings: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load standings' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const goals = await pool.query(`
      SELECT player_name, team_name, COUNT(*) AS count
      FROM match_events
      WHERE event_type IN ('Goal', 'Penalty')
      GROUP BY player_name, team_name
      ORDER BY count DESC, player_name ASC
      LIMIT 20;
    `);

    const assists = await pool.query(`
      SELECT assisting_player_name AS player_name, team_name, COUNT(*) AS count
      FROM match_events
      WHERE event_type = 'Goal' AND assisting_player_name IS NOT NULL
      GROUP BY assisting_player_name, team_name
      ORDER BY count DESC, player_name ASC
      LIMIT 20;
    `);

    const yellowCards = await pool.query(`
      SELECT player_name, team_name, COUNT(*) AS count
      FROM match_events
      WHERE event_type = 'Yellow Card'
      GROUP BY player_name, team_name
      ORDER BY count DESC, player_name ASC
      LIMIT 20;
    `);

    const redCards = await pool.query(`
      SELECT player_name, team_name, COUNT(*) AS count
      FROM match_events
      WHERE event_type = 'Red Card'
      GROUP BY player_name, team_name
      ORDER BY count DESC, player_name ASC
      LIMIT 20;
    `);

    res.json({
      goals: goals.rows,
      assists: assists.rows,
      yellowCards: yellowCards.rows,
      redCards: redCards.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

router.get('/players', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.name, p.position, p.jersey_number, t.name AS team_name
      FROM players p
      JOIN teams t ON t.id = p.team_id
      ORDER BY t.name ASC, p.jersey_number ASC NULLS LAST;
    `);
    res.json({ players: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load players' });
  }
});

router.get('/matches/:id/lineup', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM match_lineups WHERE match_id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ available: false, message: 'Lineup not yet available for this match.' });
    }
    res.json({ available: true, lineup: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load lineup' });
  }
});

module.exports = router;