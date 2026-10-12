const express = require('express');
const store = require('../store');
const wrap = require('../wrap');

const router = express.Router();

// GET /api/meets
router.get('/', wrap(async (req, res) => {
  res.json(await store.listMeets());
}));

// POST /api/meets  { title, date, time, fee }
router.post('/', wrap(async (req, res) => {
  const { title, sport, date, time, fee } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const meet = await store.createMeet({ title: String(title).trim(), sport: sport && String(sport).trim(), date, time, fee });
  res.status(201).json(meet);
}));

// GET /api/meets/:meetId
router.get('/:meetId', wrap(async (req, res) => {
  const meet = await store.getMeet(req.params.meetId);
  if (!meet) return res.status(404).json({ error: 'meet not found' });
  res.json(meet);
}));

// POST /api/meets/:meetId/rsvp  { name, status: 'going' | 'waitlist' | 'out' }
router.post('/:meetId/rsvp', wrap(async (req, res) => {
  const { name, status } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!['going', 'waitlist', 'out'].includes(status)) {
    return res.status(400).json({ error: "status must be 'going', 'waitlist', or 'out'" });
  }
  const meet = await store.rsvpMeet(req.params.meetId, String(name).trim(), status);
  if (!meet) return res.status(404).json({ error: 'meet not found' });
  res.json(meet);
}));

module.exports = router;
