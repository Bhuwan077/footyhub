const express = require('express');
const path = require('path');
const pool = require('./db/db');
const cron = require('node-cron');
const syncLiveMatches = require('./scripts/syncLive');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files (CSS)
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const indexRouter = require('./routes/index');
const uclRouter = require('./routes/ucl');

app.use('/', indexRouter);
app.use('/ucl', uclRouter);

// Sync live match scores/status every minute
cron.schedule('* * * * *', () => {
  syncLiveMatches().catch(err => console.error('Cron sync failed:', err.message));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});