// Simple in-memory data store.
//
// This resets whenever the service restarts or redeploys. It's enough to get
// Pivo's frontend talking to a real API and to make the Wise webhook flow
// work end-to-end. When you're ready for durable storage, swap this module
// for a Postgres-backed one (Render Postgres works well) without touching
// the route files — they only call the functions exported below.

const { nanoid } = require('nanoid');

const db = {
  clubs: [],       // { id, name, sport, dues, members: [{ id, name, paid }] }
  meets: [],        // { id, title, date, time, fee, going: [], waitlist: [], paidBy: [] }
  competitions: [], // { id, name, fee, teams: [], registered: [] }
  payments: new Map(), // ref -> { ref, kind, targetId, memberId, amount, status, createdAt, confirmedAt }
};

function uid() {
  return nanoid(10);
}

// ---------- Clubs ----------
function listClubs() {
  return db.clubs;
}

function createClub({ name, sport, dues }) {
  const club = {
    id: uid(),
    name,
    sport: sport || 'General',
    dues: Number(dues) || 0,
    members: [{ id: uid(), name: 'You', paid: false }],
  };
  db.clubs.push(club);
  return club;
}

function getClub(clubId) {
  return db.clubs.find((c) => c.id === clubId) || null;
}

function addClubMember(clubId, name) {
  const club = getClub(clubId);
  if (!club) return null;
  const member = { id: uid(), name, paid: false };
  club.members.push(member);
  return member;
}

function setClubMemberPaid(clubId, memberId, paid) {
  const club = getClub(clubId);
  if (!club) return null;
  const member = club.members.find((m) => m.id === memberId);
  if (!member) return null;
  member.paid = !!paid;
  return member;
}

// ---------- Meets ----------
function listMeets() {
  return db.meets;
}

function createMeet({ title, date, time, fee }) {
  const meet = {
    id: uid(),
    title,
    date: date || 'TBD',
    time: time || 'TBD',
    fee: Number(fee) || 0,
    going: [],
    waitlist: [],
    paidBy: [],
  };
  db.meets.push(meet);
  return meet;
}

function getMeet(meetId) {
  return db.meets.find((m) => m.id === meetId) || null;
}

function rsvpMeet(meetId, name, status) {
  const meet = getMeet(meetId);
  if (!meet) return null;
  meet.going = meet.going.filter((n) => n !== name);
  meet.waitlist = meet.waitlist.filter((n) => n !== name);
  if (status === 'going') meet.going.push(name);
  if (status === 'waitlist') meet.waitlist.push(name);
  return meet;
}

function markMeetPaid(meetId, name) {
  const meet = getMeet(meetId);
  if (!meet) return null;
  if (!meet.paidBy.includes(name)) meet.paidBy.push(name);
  return meet;
}

// ---------- Competitions ----------
function listCompetitions() {
  return db.competitions;
}

function createCompetition({ name, fee, teams }) {
  const competition = {
    id: uid(),
    name,
    fee: Number(fee) || 0,
    teams: Array.isArray(teams) && teams.length ? teams : ['Team A', 'Team B'],
    registered: [],
  };
  db.competitions.push(competition);
  return competition;
}

function getCompetition(competitionId) {
  return db.competitions.find((c) => c.id === competitionId) || null;
}

function registerForCompetition(competitionId, name) {
  const competition = getCompetition(competitionId);
  if (!competition) return null;
  if (!competition.registered.includes(name)) competition.registered.push(name);
  return competition;
}

// ---------- Payments (Wise reference tracking) ----------
// kind: 'club_dues' | 'meet_fee' | 'competition_fee'
function createPaymentRequest({ kind, targetId, memberId, memberName, amount }) {
  const ref = `CH-${uid()}`.toUpperCase();
  const record = {
    ref,
    kind,
    targetId,
    memberId: memberId || null,
    memberName,
    amount: Number(amount) || 0,
    status: 'pending',
    createdAt: new Date().toISOString(),
    confirmedAt: null,
  };
  db.payments.set(ref, record);
  return record;
}

function getPaymentByRef(ref) {
  return db.payments.get(ref) || null;
}

function confirmPayment(ref) {
  const record = db.payments.get(ref);
  if (!record) return null;
  record.status = 'confirmed';
  record.confirmedAt = new Date().toISOString();

  // Reflect the confirmation back onto the underlying club/meet/competition.
  if (record.kind === 'club_dues') {
    setClubMemberPaid(record.targetId, record.memberId, true);
  } else if (record.kind === 'meet_fee') {
    markMeetPaid(record.targetId, record.memberName);
  } else if (record.kind === 'competition_fee') {
    registerForCompetition(record.targetId, record.memberName);
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
