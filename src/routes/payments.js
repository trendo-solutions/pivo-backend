const express = require('express');
const crypto = require('crypto');
const store = require('../store');

const router = express.Router();

const VALID_KINDS = ['club_dues', 'meet_fee', 'competition_fee', 'store_order'];

// POST /api/payments  { kind, targetId, memberId, memberName, amount }
// Creates a payment reference the frontend shows to the payer (matches the
// "Wise payment link" modal in the Pivo UI). The reference is what we
// match against when Wise's webhook confirms the transfer.
router.post('/', (req, res) => {
  const { kind, targetId, memberId, memberName, amount } = req.body || {};
  if (!VALID_KINDS.includes(kind)) {
    return res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
  }
  if (!targetId) return res.status(400).json({ error: 'targetId is required' });
  if (!memberName || !String(memberName).trim()) {
    return res.status(400).json({ error: 'memberName is required' });
  }

  const record = store.createPaymentRequest({
    kind,
    targetId,
    memberId,
    memberName: String(memberName).trim(),
    amount,
  });

  res.status(201).json(record);
});

// GET /api/payments/:ref
router.get('/:ref', (req, res) => {
  const record = store.getPaymentByRef(req.params.ref);
  if (!record) return res.status(404).json({ error: 'payment reference not found' });
  res.json(record);
});

// Dev-only helper that stands in for a real Wise webhook while you're
// testing locally or before Wise is fully wired up. Disabled in production
// so nobody can mark a payment "confirmed" without a real webhook call.
if (process.env.NODE_ENV !== 'production') {
  router.post('/:ref/simulate-confirm', (req, res) => {
    const record = store.confirmPayment(req.params.ref);
    if (!record) return res.status(404).json({ error: 'payment reference not found' });
    res.json(record);
  });
}

module.exports = router;

// ---------- Wise webhook ----------
//
// Wise signs webhook deliveries with RSA-SHA256 over the raw request body,
// using the "X-Signature-SHA256" header and Wise's published public key —
// see https://docs.wise.com/api-docs/features/webhooks-notifications/event-notifications
// This module verifies with that public key when WISE_WEBHOOK_PUBLIC_KEY is
// set. Until you've added your production Wise credentials, requests are
// accepted unverified (a warning is logged) so you can build end-to-end first.
function verifyWiseSignature(rawBody, signatureHeader) {
  const publicKey = process.env.WISE_WEBHOOK_PUBLIC_KEY;
  if (!publicKey || !signatureHeader) return { verified: false, skipped: true };
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(rawBody);
    verifier.end();
    const verified = verifier.verify(publicKey, signatureHeader, 'base64');
    return { verified, skipped: false };
  } catch (err) {
    return { verified: false, skipped: false, error: err.message };
  }
}

// Mounted separately at /api/webhooks/wise in server.js so it can read the
// raw request body (needed for signature verification) before JSON parsing.
function wiseWebhookHandler(req, res) {
  const signatureHeader = req.header('X-Signature-SHA256');
  const { verified, skipped, error } = verifyWiseSignature(req.rawBody, signatureHeader);

  if (!skipped && !verified) {
    console.warn('Wise webhook signature check failed', error || '');
    return res.status(401).json({ error: 'invalid signature' });
  }
  if (skipped) {
    console.warn('Wise webhook received without WISE_WEBHOOK_PUBLIC_KEY set — accepting unverified. Set that env var before going live.');
  }

  let payload;
  try {
    payload = JSON.parse(req.rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'invalid JSON payload' });
  }

  // Wise's transfer state-change events carry the transfer reference under
  // data.resource / data.current_state depending on event type. Adjust this
  // extraction once you've confirmed the exact event type you've subscribed
  // to (e.g. "transfers#state-change") in the Wise dashboard.
  const reference =
    payload?.data?.reference ||
    payload?.data?.resource?.reference ||
    payload?.reference;
  const state = payload?.data?.current_state || payload?.data?.state;

  if (!reference) {
    return res.status(400).json({ error: 'no payment reference found in payload' });
  }

  const record = store.getPaymentByRef(reference);
  if (!record) {
    // Not one of ours (or already cleaned up) — acknowledge so Wise doesn't retry.
    return res.status(200).json({ ok: true, matched: false });
  }

  const isSuccessState = !state || ['outgoing_payment_sent', 'funds_converted', 'completed'].includes(state);
  if (isSuccessState) {
    store.confirmPayment(reference);
  }

  res.status(200).json({ ok: true, matched: true });
}

module.exports.wiseWebhookHandler = wiseWebhookHandler;
