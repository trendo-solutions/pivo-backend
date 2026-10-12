const express = require('express');
const store = require('../store');
const wrap = require('../wrap');

const router = express.Router();

// GET /api/clubs
router.get('/', wrap(async (req, res) => {
  res.json(await store.listClubs());
}));

// POST /api/clubs  { name, sport, dues }
router.post('/', wrap(async (req, res) => {
  const { name, sport, dues } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const club = await store.createClub({ name: String(name).trim(), sport, dues });
  res.status(201).json(club);
}));

// GET /api/clubs/:clubId
router.get('/:clubId', wrap(async (req, res) => {
  const club = await store.getClub(req.params.clubId);
  if (!club) return res.status(404).json({ error: 'club not found' });
  res.json(club);
}));

// POST /api/clubs/:clubId/members  { name }
router.post('/:clubId/members', wrap(async (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const member = await store.addClubMember(req.params.clubId, String(name).trim());
  if (!member) return res.status(404).json({ error: 'club not found' });
  res.status(201).json(member);
}));

// PATCH /api/clubs/:clubId/members/:memberId  { paid }
router.patch('/:clubId/members/:memberId', wrap(async (req, res) => {
  const { paid } = req.body || {};
  const member = await store.setClubMemberPaid(req.params.clubId, req.params.memberId, paid);
  if (!member) return res.status(404).json({ error: 'club or member not found' });
  res.json(member);
}));

module.exports = router;
