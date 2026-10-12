const express = require('express');
const cors = require('cors');

const clubsRouter = require('./routes/clubs');
const meetsRouter = require('./routes/meets');
const competitionsRouter = require('./routes/competitions');
const paymentsRouter = require('./routes/payments');
const { wiseWebhookHandler } = require('./routes/payments');

const app = express();
const PORT = process.env.PORT || 3000;

// Comma-separated list of allowed origins, e.g. "https://your-app.netlify.app,http://localhost:5173"
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true, // wide open until ALLOWED_ORIGINS is set — lock this down before going live
  })
);

// The Wise webhook needs the raw request body for signature verification,
// so it's mounted before express.json() with its own raw-body capture.
app.post(
  '/api/webhooks/wise',
  express.raw({ type: '*/*' }),
  (req, res, next) => {
    req.rawBody = req.body; // Buffer, set by express.raw()
    next();
  },
  wiseWebhookHandler
);

app.use(express.json());

app.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'pivo-backend' });
});

// Diagnostic: run the exact statement shapes the app's write paths use, each
// inside its own dedicated-client transaction that always rolls back — so the
// response shows WHICH statement fails and why, without leaving any trace.
app.get('/healthz/db', async (req, res) => {
  const out = { ok: true, service: 'pivo-backend', probes: {} };
  const pool = require('./db').pool;

  async function runProbe(key, fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
      await client.query('ROLLBACK');
      out.probes[key] = 'ok';
    } catch (err) {
      out.probes[key] = { failed: true, message: err.message, code: err.code, routine: err.routine };
      try { await client.query('ROLLBACK'); } catch (_) { /* aborted txn */ }
    } finally {
      client.release();
    }
  }

  try {
    const info = await pool.query(`
      SELECT current_user AS role,
             current_database() AS db,
             current_setting('transaction_read_only') AS session_read_only,
             current_setting('server_version') AS server_version
    `);
    Object.assign(out, info.rows[0]);
  } catch (err) {
    out.info_error = { message: err.message, code: err.code };
  }

  let meetId = null;
  let compId = null;
  try {
    const m = await pool.query('SELECT id FROM meets ORDER BY created_at LIMIT 1');
    meetId = m.rows[0] && m.rows[0].id;
    const c = await pool.query('SELECT id FROM competitions ORDER BY created_at LIMIT 1');
    compId = c.rows[0] && c.rows[0].id;
  } catch (err) {
    out.id_error = { message: err.message, code: err.code };
  }

  await runProbe('create_table', (cl) => cl.query('CREATE TABLE IF NOT EXISTS _write_probe(id int)'));
  await runProbe('delete_rsvps', (cl) => cl.query("DELETE FROM meet_rsvps WHERE meet_id = '__probe__' AND name = '__probe__'"));
  if (meetId) {
    await runProbe('rsvp_insert_delete', async (cl) => {
      await cl.query("INSERT INTO meet_rsvps (meet_id, name, status) VALUES ($1, '__probe__', 'going')", [meetId]);
      await cl.query("DELETE FROM meet_rsvps WHERE meet_id = $1 AND name = '__probe__'", [meetId]);
    });
    await runProbe('meet_insert_delete', async (cl) => {
      await cl.query("INSERT INTO meets (id, title, sport, date, time, fee) VALUES ('__probe__', 'Probe', 'General', 'TBD', 'TBD', 0)");
      await cl.query("DELETE FROM meets WHERE id = '__probe__'");
    });
  }
  if (compId) {
    await runProbe('comp_register_on_conflict', (cl) =>
      cl.query("INSERT INTO competition_registrations (competition_id, name) VALUES ($1, '__probe__') ON CONFLICT DO NOTHING", [compId])
    );
  }

  res.json(out);
});

// Friendly index — the root is an API server, not a website
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'pivo-backend',
    site: 'https://pivo-sports.netlify.app',
    endpoints: [
      'GET /healthz',
      'GET /healthz/db (connection diagnostic)',
      'GET/POST /api/meets (+ /:meetId/rsvp)',
      'GET/POST /api/clubs',
      'GET/POST /api/competitions',
      'POST /api/payments (Wise checkout)',
      'POST /api/webhooks/wise (Wise webhook receiver)',
    ],
  });
});

app.use('/api/clubs', clubsRouter);
app.use('/api/meets', meetsRouter);
app.use('/api/competitions', competitionsRouter);
app.use('/api/payments', paymentsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  // Pre-launch only: echo the real failure so diagnostics don't require log
  // access. REMOVE detail/code/where before the site goes public.
  res.status(500).json({
    error: 'internal server error',
    detail: err.message || String(err),
    code: err.code || null,
    where: ((err.stack || '').split('\n')[1] || '').trim() || null,
  });
});

// Boot: prepare the schema in Neon first, then start listening. If the
// database is unreachable at boot we exit non-zero so Render surfaces a
// failed deploy instead of running with a broken data layer.
const { ensureSchema } = require('./db');

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Pivo backend listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to prepare database schema:', err.message);
    process.exit(1);
  });
