const express = require('express');
const store = require('../store');

const router = express.Router();

// GET /api/meets
router.get('/', (req, res) => {
  res.json(store.listMeets());
});

// POST /api/meets  { title, date, time, fee }
router.post('/', (req, res) => {
  const { title, date, time, fee } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const meet = store.createMeet({ title: String(title).trim(), date, time, fee });
  res.status(201).json(meet);
});

// GET /api/meets/:meetId
router.get('/:meetId', (req, res) => {
  const meet = store.getMeet(req.params.meetId);
  if (!meet) return res.status(404).json({ error: 'meet not found' });
  res.json(meet);
});

// POST /api/meets/:meetId/rsvp  { name, status: 'going' | 'waitlist' | 'out' }
router.post('/:meetId/rsvp', (req, res) => {
  const { name, status } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!['going', 'waitlist', 'out'].includes(status)) {
    return res.status(400).json({ error: "status must be 'going', 'waitlist', or 'out'" });
  }
  const meet = store.rsvpMeet(req.params.meetId, String(name).trim(), status);
  if (!meet) return res.status(404).json({ error: 'meet not found' });
  res.json(meet);
});

module.exports = router;
