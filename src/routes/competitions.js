const express = require('express');
const store = require('../store');

const router = express.Router();

// GET /api/competitions
router.get('/', (req, res) => {
  res.json(store.listCompetitions());
});

// POST /api/competitions  { name, fee, teams }
router.post('/', (req, res) => {
  const { name, fee, teams } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const competition = store.createCompetition({ name: String(name).trim(), fee, teams });
  res.status(201).json(competition);
});

// GET /api/competitions/:competitionId
router.get('/:competitionId', (req, res) => {
  const competition = store.getCompetition(req.params.competitionId);
  if (!competition) return res.status(404).json({ error: 'competition not found' });
  res.json(competition);
});

module.exports = router;
