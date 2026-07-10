# FSC Memory

Durable knowledge for Florence SC Services — infrastructure facts, decisions,
and lessons that future sessions (Claude or human) should not have to
rediscover. Add dated entries at the top; never put credentials in this file
(this repo is public — keys live in the fsc-credentials store and in
Cloudflare/GitHub secrets).

**FSC memory is a three-layer system:**

1. **D1** — `memory` table in the florence-crm database, served by the worker:
   `GET/POST https://florence-crm-api.cball8475.workers.dev/memory` (Bearer
   `API_TOKEN`; GET filters: `q`, `category`, `limit`; POST body:
   `{category, title, content}` — titles are unique, re-POSTing a title
   updates the entry). Added in worker v2.24.0.
2. **md files** — this file (and other `kb/*.md`), the stable playbook layer.
3. **GitHub** — the repo itself; commit history is the audit trail.

When saving memory, write the durable summary here AND insert a condensed
entry into D1 (or, from a session without the API token, add it to the
worker's `MEMORY_SEED`-style idempotent seed and deploy).

---

## 2026-07-10 — Outreach system rebuilt end-to-end (engine v2.1, crm-api v2.25)

- **The cold-outreach engine actually runs now.** `florence-auto-outreach-emails`
  (worker/ dir in this repo) does the whole supply side on its Mon–Fri 12:00 UTC
  cron: Places discovery (dumpster + hauling, 50 km around Florence) → auto-reject
  filters (lead-gen/directories, chains/franchises, disposal facilities,
  not-relevant-to-vertical, out-of-area, uncontactable, dupes — every rejection
  logged with a reason) → website email scrape (no paid APIs) → `POST /prospects`
  → zone-exclusive enrollment (per zone+vertical, first-come-first-serve) → Resend
  sends of the 5-touch sequence (offer: 1 month free, one operator per zone) →
  daily digest to charlie@. Phases run inline in one invocation — **a Worker
  cannot fetch its own hostname** (error 1042 comes back as a response, not an
  exception), which is why v2.0's HTTP self-chaining died silently.
- **Kill switch ships PAUSED**: D1 `data_store.outreach_toggle` (missing row ⇒
  paused). Paused = live dry-run (discover/add/enroll + digest, zero prospect
  emails). Un-pause from dashboard 🤖 Automation or POST /outreach-toggle.
  Hard override: engine var `OUTREACH_PAUSED`.
- **Email rules:** only the engine holds `RESEND_API_KEY`; crm-api and
  lead-followup send via its `Mailer` service-binding entrypoint (suppression
  checked on every send; sent-state only on Resend 2xx). lead-followup v3 fixed
  the marks-sent-on-failure bug; Brevo is gone everywhere. `suppression` +
  `outreach_log` are new D1 tables (self-ensured).
- **florence-outreach is no longer an open Anthropic proxy** — Bearer required,
  validated by delegation to crm-api `GET /auth/check`; dashboard reaches it via
  dashboard-proxy `/outreach/*` (and the engine via `/engine/*`), token injected
  server-side behind Cloudflare Access. dashboard-proxy keeps `workers_dev=false`
  on purpose (a workers.dev route would bypass Access).
- **Everything lives in site-admin now** (all 5 florence workers + dashboard +
  per-worker deploy workflows). Dashboard Pages deploys via CI too
  (`deploy-dashboard.yml`); the `florence-dashboard` Pages project is
  direct-upload. Google Places key: engine env secret preferred, D1
  `data_store.google_places_api_key` fallback until the GH repo secret is added.
- Remote-session constraints (still true, learned again): sessions can't set GH
  secrets, and the permission layer also blocks `wrangler secret put` / direct
  `wrangler deploy` — **deploys go through workflow_dispatch on the repo's own
  Actions** (a branch dispatch runs the branch's workflow file; new workflow
  files only register once on main).
- See SYSTEM.md (root) for the full map + runbook, SMOKE-TEST.md for evidence.

## 2026-07-02 — Lead-alert system audit + Resend email backup (v2.23.0)

### How lead alerts work
- Leads arrive three ways: website forms (`POST /submit-lead`), CallRail
  call-completed webhooks (`POST /webhook/callrail`), and manual/API creates
  (`POST /leads`). All run through the `florence-crm-api` Cloudflare Worker
  (`https://florence-crm-api.cball8475.workers.dev`, D1 db `florence-crm`).
- Every new lead triggers `notifyOwner()` (added in v2.23.0):
  1. Twilio SMS to the operator cell from +1 843-773-4140 (unchanged behavior).
  2. Backup email via Resend — `leads@florencescservices.com` →
     `cball8475@gmail.com` — which also states whether the SMS succeeded.
     Override with `LEAD_ALERT_TO` / `LEAD_ALERT_FROM` worker vars.
  3. Both send results logged to `lead_events` as `event_type = 'owner_alert'`
     — check `GET /leads/:id/events` when someone says "I didn't get a text."

### CallRail (verified 2026-07-02 from the live swap.js config, company 322241453)
- **(843) 938-0480 — the number on every page of florencescservices.com — is
  itself a CallRail tracking number.** All calls to it go through CallRail
  even with JavaScript blocked.
- (843) 977-3419 is a second CallRail pool number used for dynamic
  source-attribution swapping.
- The swap target is the personal cell 843-758-1987, which appears **nowhere**
  on the site (verified) — no path bypasses CallRail.
- CallRail swap script is on every page showing the number except the
  noindexed permit-guide blog page (harmless — displayed number is already the
  tracking number).
- CallRail webhook → worker confirmed configured and working (Charlie
  confirmed account side; worker side tested live).
- **Calls under 38 seconds are dropped as spam** by the worker
  (`SPAM_MIN_DURATION`) — no lead, no text. Restored after the Voice Assist
  trial ended. Remember this before debugging "missing" call leads.

### Twilio
- Owner-alert SMS delivery confirmed working 2026-07-02 (test leads #97, #98,
  #99 — delete from dashboard). A2P concerns from the earlier campaign denial
  (see TWILIO-A2P-RESUBMISSION.md in cball8475.github.io) are not currently
  blocking delivery.
- Caveat: Twilio can accept a message that carriers later drop (error 30034).
  `owner_alert` events showing `sent: true` with no text received → check
  Twilio Console → Monitor → Messaging logs.

### Deploy + secrets
- The worker auto-deploys from `main` via
  `.github/workflows/deploy-worker.yml` (repo secret `CLOUDFLARE_API_TOKEN`).
- **Email alerts stay OFF until the `RESEND_API_KEY` Actions repo secret is
  added to site-admin** (same key the eaton-ehs-api weekly digest uses) and
  the deploy workflow is re-run — the workflow then syncs it to the worker
  automatically. Until then, `owner_alert` events show
  `email: { sent: false, reason: "resend_key_missing" }`.
- Remote Claude Code sessions **cannot** set GitHub Actions secrets: the
  session's GitHub proxy authenticates api.github.com but explicitly blocks
  Actions-secrets endpoints, there is no `gh` CLI, and no Cloudflare / Twilio
  / Resend / CRM `API_TOKEN` credentials exist in any repo (by design — they
  live only in the fsc-credentials store). Secret changes are a
  Charlie-from-phone task: GitHub → site-admin → Settings → Secrets and
  variables → Actions.
