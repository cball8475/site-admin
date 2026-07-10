# florence-auto-outreach-emails — the outreach engine (v2)

Recruits dumpster/junk-hauling operators automatically, Mon–Fri 12:00 UTC:
Google Places discovery → auto-reject filters (logged reasons) → website
email scrape → `POST /prospects` → zone-exclusive enrollment → Resend sends
of due 5-touch steps (marked sent **only** on 2xx) → daily digest to Charlie.
Every action is a row in the D1 `outreach_log` table. Full story: root
[SYSTEM.md](../../SYSTEM.md).

Ships **paused** (D1 `outreach_toggle`, fails safe when missing): while
paused it discovers/adds/enrolls as a live dry-run and still sends the
digest, but never emails a prospect. Hard override: `OUTREACH_PAUSED` var.

Also exports the **`Mailer`** WorkerEntrypoint — the single Resend sender
(with suppression check) that `florence-crm-api` and `florence-lead-followup`
use via service bindings, so the Resend key lives on exactly one worker.

## Endpoints

| Route | Auth | What |
|---|---|---|
| `GET /preflight` | public | readiness booleans (D1, Resend key present, CRM auth chain, Places key source, paused state) |
| `GET\|POST /unsubscribe?id=&t=` | public (HMAC) | one-click opt-out → permanent suppression + unenroll |
| `POST /trigger?phase=&dry=1` | ✔ | run pipeline now (phases self-chain; `dry=1` = no prospect sends) |
| `GET /preview?vertical=&company=&contact=&zone=` | ✔ | render all 5 emails without sending |
| `POST /test-email` | ✔ | production-path test email to Charlie |
| `GET /status` | ✔ | toggle, due count, recent runs, queue, operators, suppression |
| `GET /outreach-log?event=&day=&limit=` | ✔ | audit trail |
| `GET\|POST /toggle` | ✔ | kill switch |
| `POST /email-search {prospect_id\|website}` | ✔ | D1-first, then homepage+contact scrape; saves onto the prospect |
| `POST /stop {prospect_id}` | ✔ | unenroll |

Auth ✔ = `Authorization: Bearer <CRM token>` (or `ADMIN_SECRET` /
CI-rotated `SMOKE_TOKEN`). The dashboard reaches these via `/engine/*`
through florence-dashboard-proxy (token injected server-side).

## Test

```sh
curl https://florence-auto-outreach-emails.cball8475.workers.dev/preflight
curl -H "Authorization: Bearer $TOKEN" ".../preview?vertical=dumpster"
curl -X POST -H "Authorization: Bearer $TOKEN" ".../trigger?dry=1"   # then read /outreach-log
```

Secrets (Cloudflare): `RESEND_API_KEY`, `CRM_API_TOKEN`, `UNSUB_SECRET`,
`GOOGLE_PLACES_API_KEY` (falls back to D1 `data_store.google_places_api_key`),
optional `ADMIN_SECRET`, CI-rotated `SMOKE_TOKEN`. Deploys via
`.github/workflows/deploy-outreach-engine.yml`.
