const express = require('express');
const cors = require('cors');

const clubsRouter = require('./routes/clubs');
const meetsRouter = require('./routes/meets');
const competitionsRouter = require('./routes/competitions');
const paymentsRouter = require('./routes/payments');
const { wiseWebhookHandler } = require('./routes/payments');
const { query: dbQuery } = require('./db');

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

// Diagnostic: what DB connection does THIS instance actually hold, and can it
// write? The write probe is a CREATE TABLE inside a transaction that always
// rolls back, so nothing is ever left behind. Answers "is Render's DATABASE_URL
// a read-only role/endpoint?" in one request.
app.get('/healthz/db', async (req, res) => {
  const out = { ok: true, service: 'pivo-backend' };
  try {
    const info = await dbQuery(`
      SELECT current_user AS role,
             current_database() AS db,
             inet_server_addr() AS server_ip,
             current_setting('transaction_read_only') AS session_read_only,
             current_setting('server_version') AS server_version
    `);
    Object.assign(out, info.rows[0]);
  } catch (err) {
    out.info_error = { message: err.message, code: err.code, routine: err.routine };
  }
  try {
    await dbQuery('BEGIN');
    await dbQuery('CREATE TABLE IF NOT EXISTS _write_probe(id int)');
    await dbQuery('ROLLBACK');
    out.write_probe = 'ok';
  } catch (err) {
    out.write_probe = 'failed';
    out.write_error = { message: err.message, code: err.code, routine: err.routine };
    try { await dbQuery('ROLLBACK'); } catch (_) { /* connection may be dead */ }
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
  res.status(500).json({ error: 'internal server error' });
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
