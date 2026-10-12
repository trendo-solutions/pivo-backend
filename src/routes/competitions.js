const express = require('express');
const store = require('../store');
const wrap = require('../wrap');

const router = express.Router();

// GET /api/competitions
router.get('/', wrap(async (req, res) => {
  res.json(await store.listCompetitions());
}));

// POST /api/competitions  { name, fee, teams }
router.post('/', wrap(async (req, res) => {
  const { name, sport, fee, teams } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const competition = await store.createCompetition({ name: String(name).trim(), sport: sport && String(sport).trim(), fee, teams });
  res.status(201).json(competition);
}));

// GET /api/competitions/:competitionId
router.get('/:competitionId', wrap(async (req, res) => {
  const competition = await store.getCompetition(req.params.competitionId);
  if (!competition) return res.status(404).json({ error: 'competition not found' });
  res.json(competition);
}));

// POST /api/competitions/:competitionId/register  { name }
// Free competitions register directly; paid ones are registered by the
// payment webhook (kind: competition_fee) after the transfer confirms.
router.post('/:competitionId/register', wrap(async (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const competition = await store.registerForCompetition(req.params.competitionId, String(name).trim());
  if (!competition) return res.status(404).json({ error: 'competition not found' });
  res.json(competition);
}));

module.exports = router;
