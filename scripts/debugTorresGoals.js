require('dotenv').config();
const pool = require('../db/db');

async function main() {
  try {
    const result = await pool.query(`
      SELECT id, highlightly_match_id, event_type, player_name, player_id,
             team_name, match_time, competition
      FROM match_events
      WHERE competition = 'UCL'
        AND event_type IN ('Goal', 'Penalty')
        AND player_name ILIKE '%Ferr%Torres%'
      ORDER BY highlightly_match_id, match_time;
    `);

    console.log(`Found ${result.rows.length} goal row(s) for Ferran Torres:`);
    console.table(result.rows);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();