const express = require('express');
const store = require('../store');

const router = express.Router();

// GET /api/clubs
router.get('/', (req, res) => {
  res.json(store.listClubs());
});

// POST /api/clubs  { name, sport, dues }
router.post('/', (req, res) => {
  const { name, sport, dues } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const club = store.createClub({ name: String(name).trim(), sport, dues });
  res.status(201).json(club);
});

// GET /api/clubs/:clubId
router.get('/:clubId', (req, res) => {
  const club = store.getClub(req.params.clubId);
  if (!club) return res.status(404).json({ error: 'club not found' });
  res.json(club);
});

// POST /api/clubs/:clubId/members  { name }
router.post('/:clubId/members', (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const member = store.addClubMember(req.params.clubId, String(name).trim());
  if (!member) return res.status(404).json({ error: 'club not found' });
  res.status(201).json(member);
});

// PATCH /api/clubs/:clubId/members/:memberId  { paid }
router.patch('/:clubId/members/:memberId', (req, res) => {
  const { paid } = req.body || {};
  const member = store.setClubMemberPaid(req.params.clubId, req.params.memberId, paid);
  if (!member) return res.status(404).json({ error: 'club or member not found' });
  res.json(member);
});

module.exports = router;
