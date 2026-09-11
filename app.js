const express = require('express');
const path = require('path');
const pool = require('./db/db');
const cron = require('node-cron');
const cors = require('cors');
const syncLiveMatches = require('./scripts/syncLive');
const syncLineups = require('./scripts/syncLineups');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so the static frontend (different domain) can fetch this API
app.use(cors());

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files (CSS)
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const indexRouter = require('./routes/index');
const uclRouter = require('./routes/ucl');
const footballRouter = require('./routes/football');

app.use('/', indexRouter);
app.use('/api/ucl', uclRouter);
app.use('/api/football', footballRouter);

// Sync live match scores/status every minute
cron.schedule('* * * * *', () => {
  syncLiveMatches().catch(err => console.error('Cron sync failed:', err.message));
});

// Sync lineups every 5 minutes (lineups only publish ~40 min before kickoff)
cron.schedule('*/5 * * * *', () => {
  syncLineups().catch(err => console.error('Lineup sync failed:', err.message));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});