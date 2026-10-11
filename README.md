# Pivo backend

Express API for the Pivo app: clubs, meets, competitions, and Wise payment
tracking. Data is stored in memory (see `src/store.js`) — it resets on
restart. Swap that module for a Postgres-backed one when you're ready for
durable storage; the routes never touch storage directly.

## Endpoints

- `GET  /healthz`
- `GET  /api/clubs` · `POST /api/clubs` · `GET /api/clubs/:id`
- `POST /api/clubs/:id/members` · `PATCH /api/clubs/:id/members/:memberId`
- `GET  /api/meets` · `POST /api/meets` · `GET /api/meets/:id`
- `POST /api/meets/:id/rsvp`
- `GET  /api/competitions` · `POST /api/competitions` · `GET /api/competitions/:id`
- `POST /api/payments` — create a payment reference (club dues / meet fee / competition fee)
- `GET  /api/payments/:ref` — check a payment's status
- `POST /api/payments/:ref/simulate-confirm` — dev-only, disabled when `NODE_ENV=production`
- `POST /api/webhooks/wise` — Wise webhook receiver

## Local setup

```bash
npm install
npm run dev      # restarts on file changes (Node 18+ --watch)
```

Server listens on `PORT` (defaults to 3000).

## Environment variables

| Variable                  | Required | Purpose                                                                 |
|----------------------------|----------|--------------------------------------------------------------------------|
| `PORT`                     | no       | Set automatically by Render                                             |
| `ALLOWED_ORIGINS`          | recommended | Comma-separated list of frontend origins for CORS, e.g. your Netlify URL |
| `WISE_WEBHOOK_PUBLIC_KEY`  | before going live | Wise's published public key, used to verify webhook signatures     |
| `NODE_ENV`                 | recommended | Set to `production` on Render — disables the simulate-confirm endpoint |

## Deploying to Render

1. Push this folder to a Git repo (GitHub/GitLab/Bitbucket).
2. In Render: **New → Blueprint**, point it at the repo — `render.yaml` here
   defines the service, so most fields are pre-filled.
   - Or **New → Web Service** manually: runtime `Node`, build command
     `npm install`, start command `npm start`.
3. Set `ALLOWED_ORIGINS` to your Netlify site's URL once that's live.
4. Set `WISE_WEBHOOK_PUBLIC_KEY` from your Wise developer dashboard, and
   point Wise's webhook config at `https://<your-render-url>/api/webhooks/wise`.

## Wise webhook notes

This is wired up per [Wise's event-notification docs](https://docs.wise.com/api-docs/features/webhooks-notifications/event-notifications):
signature verification via `X-Signature-SHA256` (RSA-SHA256 over the raw
body), reference extraction from the event payload. **Before going live**,
confirm against a real Wise sandbox event that:
- the payload path used to pull out the transfer `reference` matches what
  Wise actually sends for the event type you subscribe to, and
- the `current_state` values checked in `isSuccessState` (in
  `src/routes/payments.js`) match Wise's real state names.

Until `WISE_WEBHOOK_PUBLIC_KEY` is set, incoming webhooks are accepted
unverified (with a console warning) so you can build the rest of the flow
first — don't ship that to production as-is.
