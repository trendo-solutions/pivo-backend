// Postgres-backed data store (Neon) — durable across restarts, redeploys and
// free-tier spin-downs.
//
// Same public API and same returned shapes as the old in-memory store; every
// function is now async. Route files only call the functions exported below.

const { nanoid } = require('nanoid');
const db = require('./db');

function uid() {
  return nanoid(10);
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

// ---------- Clubs ----------
async function listClubs() {
  const { rows } = await db.query('SELECT id, name, sport, dues FROM clubs ORDER BY created_at, id');
  if (!rows.length) return [];
  const members = await db.query(
    'SELECT id, club_id, name, paid FROM club_members WHERE club_id = ANY($1::text[]) ORDER BY created_at, id',
    [rows.map((c) => c.id)]
  );
  const byClub = new Map();
  for (const m of members.rows) {
    if (!byClub.has(m.club_id)) byClub.set(m.club_id, []);
    byClub.get(m.club_id).push({ id: m.id, name: m.name, paid: m.paid });
  }
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    sport: c.sport,
    dues: Number(c.dues),
    members: byClub.get(c.id) || [],
  }));
}

async function createClub({ name, sport, dues }) {
  const id = uid();
  const { rows } = await db.query(
    'INSERT INTO clubs (id, name, sport, dues) VALUES ($1, $2, $3, $4) RETURNING id, name, sport, dues',
    [id, name, sport || 'General', Number(dues) || 0]
  );
  const c = rows[0];
  const member = { id: uid(), name: 'You', paid: false };
  await db.query('INSERT INTO club_members (id, club_id, name, paid) VALUES ($1, $2, $3, $4)', [
    member.id,
    id,
    member.name,
    member.paid,
  ]);
  return { id: c.id, name: c.name, sport: c.sport, dues: Number(c.dues), members: [member] };
}

async function getClub(clubId) {
  const { rows } = await db.query('SELECT id, name, sport, dues FROM clubs WHERE id = $1', [clubId]);
  if (!rows.length) return null;
  const c = rows[0];
  const members = await db.query(
    'SELECT id, name, paid FROM club_members WHERE club_id = $1 ORDER BY created_at, id',
    [clubId]
  );
  return {
    id: c.id,
    name: c.name,
    sport: c.sport,
    dues: Number(c.dues),
    members: members.rows.map((m) => ({ id: m.id, name: m.name, paid: m.paid })),
  };
}

async function addClubMember(clubId, name) {
  const exists = await db.query('SELECT 1 FROM clubs WHERE id = $1', [clubId]);
  if (!exists.rows.length) return null;
  const member = { id: uid(), name, paid: false };
  await db.query('INSERT INTO club_members (id, club_id, name, paid) VALUES ($1, $2, $3, $4)', [
    member.id,
    clubId,
    name,
    false,
  ]);
  return member;
}

async function setClubMemberPaid(clubId, memberId, paid) {
  const { rows } = await db.query(
    'UPDATE club_members SET paid = $1 WHERE id = $2 AND club_id = $3 RETURNING id, name, paid',
    [!!paid, memberId, clubId]
  );
  if (!rows.length) return null;
  return { id: rows[0].id, name: rows[0].name, paid: rows[0].paid };
}

// ---------- Meets ----------
const MEET_SELECT = `
  SELECT m.id, m.title, m.date, m.time, m.fee,
    COALESCE((SELECT array_agg(r.name ORDER BY r.created_at, r.name)
              FROM meet_rsvps r WHERE r.meet_id = m.id AND r.status = 'going'), '{}') AS going,
    COALESCE((SELECT array_agg(r.name ORDER BY r.created_at, r.name)
              FROM meet_rsvps r WHERE r.meet_id = m.id AND r.status = 'waitlist'), '{}') AS waitlist,
    COALESCE((SELECT array_agg(p.name ORDER BY p.created_at, p.name)
              FROM meet_payers p WHERE p.meet_id = m.id), '{}') AS paid_by
  FROM meets m`;

function meetRow(r) {
  return {
    id: r.id,
    title: r.title,
    date: r.date,
    time: r.time,
    fee: Number(r.fee),
    going: r.going || [],
    waitlist: r.waitlist || [],
    paidBy: r.paid_by || [],
  };
}

async function listMeets() {
  const { rows } = await db.query(`${MEET_SELECT} ORDER BY m.created_at, m.id`);
  return rows.map(meetRow);
}

async function getMeet(meetId) {
  const { rows } = await db.query(`${MEET_SELECT} WHERE m.id = $1`, [meetId]);
  return rows.length ? meetRow(rows[0]) : null;
}

async function createMeet({ title, date, time, fee }) {
  const id = uid();
  const { rows } = await db.query(
    'INSERT INTO meets (id, title, date, time, fee) VALUES ($1, $2, $3, $4, $5) RETURNING id, title, date, time, fee',
    [id, title, date || 'TBD', time || 'TBD', Number(fee) || 0]
  );
  const m = rows[0];
  return { id: m.id, title: m.title, date: m.date, time: m.time, fee: Number(m.fee), going: [], waitlist: [], paidBy: [] };
}

async function rsvpMeet(meetId, name, status) {
  const exists = await db.query('SELECT 1 FROM meets WHERE id = $1', [meetId]);
  if (!exists.rows.length) return null;
  // Match the old semantics exactly: remove the name everywhere first, then
  // add it back only for a valid status (re-RSVP moves them to the end).
  await db.query('DELETE FROM meet_rsvps WHERE meet_id = $1 AND name = $2', [meetId, name]);
  if (status === 'going' || status === 'waitlist') {
    await db.query('INSERT INTO meet_rsvps (meet_id, name, status) VALUES ($1, $2, $3)', [meetId, name, status]);
  }
  return getMeet(meetId);
}

async function markMeetPaid(meetId, name) {
  const exists = await db.query('SELECT 1 FROM meets WHERE id = $1', [meetId]);
  if (!exists.rows.length) return null;
  await db.query('INSERT INTO meet_payers (meet_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [meetId, name]);
  return getMeet(meetId);
}

// ---------- Competitions ----------
const COMP_SELECT = `
  SELECT c.id, c.name, c.fee,
    COALESCE((SELECT array_agg(t.name ORDER BY t.position)
              FROM competition_teams t WHERE t.competition_id = c.id), '{}') AS teams,
    COALESCE((SELECT array_agg(r.name ORDER BY r.created_at, r.name)
              FROM competition_registrations r WHERE r.competition_id = c.id), '{}') AS registered
  FROM competitions c`;

function competitionRow(r) {
  return {
    id: r.id,
    name: r.name,
    fee: Number(r.fee),
    teams: r.teams || [],
    registered: r.registered || [],
  };
}

async function listCompetitions() {
  const { rows } = await db.query(`${COMP_SELECT} ORDER BY c.created_at, c.id`);
  return rows.map(competitionRow);
}

async function getCompetition(competitionId) {
  const { rows } = await db.query(`${COMP_SELECT} WHERE c.id = $1`, [competitionId]);
  return rows.length ? competitionRow(rows[0]) : null;
}

async function createCompetition({ name, fee, teams }) {
  const id = uid();
  const teamList = Array.isArray(teams) && teams.length ? teams : ['Team A', 'Team B'];
  const { rows } = await db.query(
    'INSERT INTO competitions (id, name, fee) VALUES ($1, $2, $3) RETURNING id, name, fee',
    [id, name, Number(fee) || 0]
  );
  for (let i = 0; i < teamList.length; i += 1) {
    await db.query('INSERT INTO competition_teams (competition_id, name, position) VALUES ($1, $2, $3)', [
      id,
      String(teamList[i]),
      i,
    ]);
  }
  const c = rows[0];
  return { id: c.id, name: c.name, fee: Number(c.fee), teams: teamList.map(String), registered: [] };
}

async function registerForCompetition(competitionId, name) {
  const exists = await db.query('SELECT 1 FROM competitions WHERE id = $1', [competitionId]);
  if (!exists.rows.length) return null;
  await db.query(
    'INSERT INTO competition_registrations (competition_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [competitionId, name]
  );
  return getCompetition(competitionId);
}

// ---------- Payments (Wise reference tracking) ----------
// kind: 'club_dues' | 'meet_fee' | 'competition_fee' | 'store_order'
async function createPaymentRequest({ kind, targetId, memberId, memberName, amount }) {
  const ref = `PV-${uid()}`.toUpperCase();
  const createdAt = new Date().toISOString();
  await db.query(
    `INSERT INTO payments (ref, kind, target_id, member_id, member_name, amount, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
    [ref, kind, targetId, memberId || null, memberName, Number(amount) || 0, createdAt]
  );
  return {
    ref,
    kind,
    targetId,
    memberId: memberId || null,
    memberName,
    amount: Number(amount) || 0,
    status: 'pending',
    createdAt,
    confirmedAt: null,
  };
}

async function getPaymentByRef(ref) {
  const { rows } = await db.query('SELECT * FROM payments WHERE ref = $1', [ref]);
  if (!rows.length) return null;
  const p = rows[0];
  return {
    ref: p.ref,
    kind: p.kind,
    targetId: p.target_id,
    memberId: p.member_id,
    memberName: p.member_name,
    amount: Number(p.amount),
    status: p.status,
    createdAt: iso(p.created_at),
    confirmedAt: iso(p.confirmed_at),
  };
}

async function confirmPayment(ref) {
  const record = await getPaymentByRef(ref);
  if (!record) return null;
  const now = new Date().toISOString();
  await db.query('UPDATE payments SET status = $1, confirmed_at = $2 WHERE ref = $3', ['confirmed', now, ref]);
  record.status = 'confirmed';
  record.confirmedAt = now;

  // Reflect the confirmation back onto the underlying club/meet/competition.
  if (record.kind === 'club_dues') {
    await setClubMemberPaid(record.targetId, record.memberId, true);
  } else if (record.kind === 'meet_fee') {
    await markMeetPaid(record.targetId, record.memberName);
  } else if (record.kind === 'competition_fee') {
    await registerForCompetition(record.targetId, record.memberName);
  }
  return record;
}

module.exports = {
  uid,
  listClubs,
  createClub,
  getClub,
  addClubMember,
  setClubMemberPaid,
  listMeets,
  createMeet,
  getMeet,
  rsvpMeet,
  markMeetPaid,
  listCompetitions,
  createCompetition,
  getCompetition,
  registerForCompetition,
  createPaymentRequest,
  getPaymentByRef,
  confirmPayment,
};
