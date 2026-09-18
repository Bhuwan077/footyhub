require('dotenv').config({ quiet: true });
const pool = require('../../db/db');

async function main() {
  await pool.query(`
    ALTER TABLE players ADD COLUMN IF NOT EXISTS espn_player_id BIGINT UNIQUE;
  `);
  console.log('Migration done: players.espn_player_id added.');
  await pool.end();
}

main();