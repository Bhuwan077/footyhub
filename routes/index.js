const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const leagues = [
    { name: 'UEFA Champions League', slug: 'ucl', active: true },
    { name: 'La Liga', slug: 'laliga', active: false },
    { name: 'Premier League', slug: 'premier-league', active: false },
    { name: 'Serie A', slug: 'serie-a', active: false },
    { name: 'Bundesliga', slug: 'bundesliga', active: false }
  ];
  res.render('home', { leagues });
});

module.exports = router;