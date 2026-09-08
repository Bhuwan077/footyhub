require("dotenv").config();
const pool = require("../db/db");
const API_BASE = "https://api.football-data.org/v4";
const HEADERS = { "X-Auth-Token": process.env.FOOTBALL_API_KEY };
async function fetchJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
async function syncLiveMatches() {
  const data = await fetchJSON(
    `${API_BASE}/competitions/CL/matches?status=LIVE,IN_PLAY,PAUSED,FINISHED`,
  );
  let updated = 0;
  for (const match of data.matches) {
    const result = await pool.query(
      `UPDATE matches SET home_score = $1, away_score = $2, status = $3 WHERE api_match_id = $4`,
      [
        match.score.fullTime.home,
        match.score.fullTime.away,
        match.status,
        match.id,
      ],
    );
    if (result.rowCount > 0) updated++;
  }
  console.log(
    `[${new Date().toISOString()}] Synced ${updated} live/finished matches.`,
  );
}
module.exports = syncLiveMatches;
if (require.main === module) {
  syncLiveMatches()
    .then(() => pool.end())
    .catch((err) => {
      console.error("Sync error:", err.message);
      pool.end();
    });
}
