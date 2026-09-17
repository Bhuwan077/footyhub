const express = require('express');
const router = express.Router();
const pool = require('../db/db');

const VALID_COMPETITIONS = ['UCL', 'EPL', 'LALIGA', 'SERIEA', 'BUNDESLIGA'];

router.get('/matches', async (req, res) => {
  const competition = VALID_COMPETITIONS.includes(req.query.competition) ? req.query.competition : 'UCL';

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
      WHERE m.competition = $1
      ORDER BY m.match_date ASC;
    `;
    const result = await pool.query(query, [competition]);

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
  const competition = VALID_COMPETITIONS.includes(req.query.competition) ? req.query.competition : 'UCL';
  const stageCondition = competition === 'UCL' ? `AND stage = 'LEAGUE_PHASE'` : '';

  try {
    const query = `
      WITH comp_teams AS (
        SELECT DISTINCT team_id FROM (
          SELECT home_team_id AS team_id FROM matches WHERE competition = $1
          UNION
          SELECT away_team_id AS team_id FROM matches WHERE competition = $1
        ) x
      ),
      team_matches AS (
        SELECT home_team_id AS team_id, home_score AS goals_for, away_score AS goals_against
        FROM matches
        WHERE competition = $1 AND status = 'FINISHED' ${stageCondition}
        UNION ALL
        SELECT away_team_id AS team_id, away_score AS goals_for, home_score AS goals_against
        FROM matches
        WHERE competition = $1 AND status = 'FINISHED' ${stageCondition}
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
      JOIN comp_teams ct ON ct.team_id = t.id
      LEFT JOIN team_matches tm ON tm.team_id = t.id
      GROUP BY t.id, t.name, t.logo_url
      ORDER BY points DESC, goal_difference DESC, goals_for DESC;
    `;
    const result = await pool.query(query, [competition]);
    res.json({ standings: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load standings' });
  }
});

router.get('/stats', async (req, res) => {
  const competition = VALID_COMPETITIONS.includes(req.query.competition) ? req.query.competition : 'UCL';

  try {
    // Goals, yellow cards, and red cards are grouped by player_id (falling back to
    // trimmed player_name when player_id is null) so that name-format inconsistencies
    // from Highlightly (e.g. "E. Haaland" vs "Erling Haaland" for the same player)
    // don't split one player's tally across multiple leaderboard rows. The longest
    // name variant seen for that player_id is used as the display name, since the
    // fuller form is generally the more readable one.
    //
    // NOTE: assists can't use the same fix yet — match_events only stores
    // assisting_player_name, with no assisting_player_id column, so assist name
    // variants (e.g. "C. Gakpo" vs "Cody Gakpo") will still appear as separate rows
    // until that column is added and backfilled.

    const goals = await pool.query(`
      SELECT display_name AS player_name, team_name, cnt AS count
      FROM (
        SELECT
          COALESCE(player_id::text, TRIM(player_name)) AS group_key,
          team_name,
          COUNT(*) AS cnt,
          (ARRAY_AGG(TRIM(player_name) ORDER BY LENGTH(TRIM(player_name)) DESC))[1] AS display_name
        FROM match_events
        WHERE competition = $1 AND event_type IN ('Goal', 'Penalty')
        GROUP BY group_key, team_name
      ) s
      ORDER BY cnt DESC, display_name ASC
      LIMIT 20;
    `, [competition]);

    // Two different assist patterns coexist: La Liga stores each assist as its own
    // dedicated 'Assist' row (from Big Balls Sports Data, with a real assist player id).
    // UCL/EPL still attach the assist name to the scorer's 'Goal' row (from Highlightly,
    // no id available). This UNIONs both so every competition's assists keep working.
    const assists = await pool.query(`
      SELECT display_name AS player_name, team_name, cnt AS count
      FROM (
        SELECT
          COALESCE(player_id::text, TRIM(player_name)) AS group_key,
          team_name,
          COUNT(*) AS cnt,
          (ARRAY_AGG(TRIM(player_name) ORDER BY LENGTH(TRIM(player_name)) DESC))[1] AS display_name
        FROM match_events
        WHERE competition = $1 AND event_type = 'Assist'
        GROUP BY group_key, team_name

        UNION ALL

        SELECT
          COALESCE(assisting_player_id::text, TRIM(assisting_player_name)) AS group_key,
          team_name,
          COUNT(*) AS cnt,
          (ARRAY_AGG(TRIM(assisting_player_name) ORDER BY LENGTH(TRIM(assisting_player_name)) DESC))[1] AS display_name
        FROM match_events
        WHERE competition = $1 AND event_type = 'Goal' AND assisting_player_name IS NOT NULL
        GROUP BY group_key, team_name
      ) s
      ORDER BY cnt DESC, display_name ASC
      LIMIT 20;
    `, [competition]);

    const yellowCards = await pool.query(`
      SELECT display_name AS player_name, team_name, cnt AS count
      FROM (
        SELECT
          COALESCE(player_id::text, TRIM(player_name)) AS group_key,
          team_name,
          COUNT(*) AS cnt,
          (ARRAY_AGG(TRIM(player_name) ORDER BY LENGTH(TRIM(player_name)) DESC))[1] AS display_name
        FROM match_events
        WHERE competition = $1 AND event_type = 'Yellow Card'
        GROUP BY group_key, team_name
      ) s
      ORDER BY cnt DESC, display_name ASC
      LIMIT 20;
    `, [competition]);

    const redCards = await pool.query(`
      SELECT display_name AS player_name, team_name, cnt AS count
      FROM (
        SELECT
          COALESCE(player_id::text, TRIM(player_name)) AS group_key,
          team_name,
          COUNT(*) AS cnt,
          (ARRAY_AGG(TRIM(player_name) ORDER BY LENGTH(TRIM(player_name)) DESC))[1] AS display_name
        FROM match_events
        WHERE competition = $1 AND event_type = 'Red Card'
        GROUP BY group_key, team_name
      ) s
      ORDER BY cnt DESC, display_name ASC
      LIMIT 20;
    `, [competition]);

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
  const competition = VALID_COMPETITIONS.includes(req.query.competition) ? req.query.competition : 'UCL';

  try {
    const query = `
      WITH comp_teams AS (
        SELECT DISTINCT team_id FROM (
          SELECT home_team_id AS team_id FROM matches WHERE competition = $1
          UNION
          SELECT away_team_id AS team_id FROM matches WHERE competition = $1
        ) x
      )
      SELECT p.name, p.position, p.jersey_number, t.name AS team_name
      FROM players p
      JOIN teams t ON t.id = p.team_id
      JOIN comp_teams ct ON ct.team_id = t.id
      ORDER BY t.name ASC, p.jersey_number ASC NULLS LAST;
    `;
    const result = await pool.query(query, [competition]);
    res.json({ players: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load players' });
  }
});

module.exports = router;