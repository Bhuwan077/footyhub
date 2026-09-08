const express = require('express');
const router = express.Router();
const pool = require('../db/db');

const TABS = [
  { key: 'matches', label: 'Matches', href: '/ucl/matches' },
  { key: 'standings', label: 'Standings', href: '/ucl/standings' },
  { key: 'stats', label: 'Stats', href: '/ucl/stats' },
  { key: 'players', label: 'Players', href: '/ucl/players' }
];

router.get('/', (req, res) => res.redirect('/ucl/matches'));

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

    const LIVE_STATUSES = ['IN_PLAY', 'PAUSED', 'LIVE'];
    const live = result.rows.filter(m => LIVE_STATUSES.includes(m.status));
    const upcoming = result.rows.filter(m => !LIVE_STATUSES.includes(m.status) && m.status !== 'FINISHED');
    const finished = result.rows.filter(m => m.status === 'FINISHED').reverse();

    res.render('ucl/matches', { tabs: TABS, active: 'matches', live, upcoming, finished });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading matches');
  }
});

router.get('/standings', async (req, res) => {
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
    res.render('ucl/standings', { tabs: TABS, active: 'standings', standings: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading standings');
  }
});

router.get('/stats', (req, res) => {
  res.render('ucl/coming-soon', { tabs: TABS, active: 'stats', title: 'Stats' });
});

router.get('/players', (req, res) => {
  res.render('ucl/coming-soon', { tabs: TABS, active: 'players', title: 'Players' });
});

module.exports = router;