require('dotenv').config();
const pool = require('../db/db');

async function main() {
  const result = await pool.query(`
    SELECT event_type, COUNT(*) as count
    FROM match_events
    GROUP BY event_type
    ORDER BY count DESC;
  `);
  console.log('Event type breakdown:');
  console.table(result.rows);

  const sample = await pool.query(`SELECT * FROM match_events LIMIT 5;`);
  console.log('Sample rows:');
  console.log(sample.rows);

  await pool.end();
}

main();