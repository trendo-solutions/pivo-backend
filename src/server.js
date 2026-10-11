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

app.listen(PORT, () => {
  console.log(`Pivo backend listening on port ${PORT}`);
});
