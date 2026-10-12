// Postgres connection (Neon) + idempotent schema.
//
// DATABASE_URL must point at the *pooled* Neon connection string, e.g.
//   postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
// Render injects it from the service environment; locally export it in your shell.

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL is not set. Set it on Render (service Environment) or in your shell:\n' +
      '  export DATABASE_URL="postgresql://...-pooler.../neondb?sslmode=require"'
  );
  process.exit(1);
}

// Neon suspends idle compute on the free plan; connectionTimeout gives the
// first connection room to wake it (~0.5-2s) before giving up.
const pool = new Pool({
  connectionString,
  max: 5,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  // Idle client errors (e.g. Neon restart) must not crash the process.
  console.error('Unexpected Postgres pool error:', err.message);
});

// Runs the schema DDL. CREATE IF NOT EXISTS makes it idempotent, so booting
// against an existing database is always safe. Called once at server start.
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clubs (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      sport      TEXT NOT NULL DEFAULT 'General',
      dues       NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS club_members (
      id         TEXT PRIMARY KEY,
      club_id    TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      paid       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS meets (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      date       TEXT NOT NULL DEFAULT 'TBD',
      time       TEXT NOT NULL DEFAULT 'TBD',
      fee        NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS meet_rsvps (
      meet_id    TEXT NOT NULL REFERENCES meets(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      status     TEXT NOT NULL CHECK (status IN ('going', 'waitlist')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (meet_id, name)
    );

    CREATE TABLE IF NOT EXISTS meet_payers (
      meet_id    TEXT NOT NULL REFERENCES meets(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (meet_id, name)
    );

    CREATE TABLE IF NOT EXISTS competitions (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      fee        NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS competition_teams (
      competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      position       INT NOT NULL,
      PRIMARY KEY (competition_id, name)
    );

    CREATE TABLE IF NOT EXISTS competition_registrations (
      competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (competition_id, name)
    );

    CREATE TABLE IF NOT EXISTS payments (
      ref         TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      target_id   TEXT NOT NULL,
      member_id   TEXT,
      member_name TEXT NOT NULL,
      amount      NUMERIC NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      confirmed_at TIMESTAMPTZ
    );
  `);
}

module.exports = {
  query: (...args) => pool.query(...args),
  pool,
  ensureSchema,
};
