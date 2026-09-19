require('dotenv').config({ quiet: true });
const pool = require('../db/db');

(async () => {
  try {
    const r = await pool.query(`
      SELECT t.name,
             COUNT(*) FILTER (WHERE p.highlightly_player_id IS NOT NULL) AS highlightly_rows,
             COUNT(*) FILTER (WHERE p.espn_player_id IS NOT NULL) AS espn_rows
      FROM players p
      JOIN teams t ON t.id = p.team_id
      GROUP BY t.name
      HAVING COUNT(*) FILTER (WHERE p.highlightly_player_id IS NOT NULL) > 0
         AND COUNT(*) FILTER (WHERE p.espn_player_id IS NOT NULL) > 0
      ORDER BY t.name
    `);
    console.log(`Teams with BOTH Highlightly and ESPN player rows: ${r.rows.length}`);
    r.rows.forEach(row =>
      console.log(`  ${row.name}: highlightly=${row.highlightly_rows}, espn=${row.espn_rows}`)
    );
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();