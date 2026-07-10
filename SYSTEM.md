# Florence SC Services — Outreach System

Rebuilt 2026-07-10. This document is the map: what runs, where, on what
schedule, and how to drive it. The companion evidence page is
[SMOKE-TEST.md](SMOKE-TEST.md).

## The business model (why any of this exists)

Two sides of a local lead marketplace for the Pee Dee region:

- **Supply** — recruit local dumpster-rental / junk-hauling operators and sell
  them **exclusive** customer leads. The hook: **1 month free trial**, **one
  operator per zone**, **first come, first serve on zones**.
- **Demand** — the SEO site + CallRail produce customer leads; each is
  assigned to the operator who owns that zone; the follow-up worker makes sure
  they actually work it.

## Architecture

```
                     florencescservices.com (SEO site, CallRail)
                                   │ leads
                                   ▼
   dashboard.florencescservices.com          api.florencescservices.com
   [Cloudflare Access]                       florence-crm-api  ← the hub
   florence-dashboard-proxy ───/api/*──────▶ (D1: florence-crm)
        │        │ static                        ▲    ▲     ▲
        │        ▼                               │    │     │ Mailer RPC
        │   florence-dashboard.pages.dev         │    │     │ (service binding)
        ├──/engine/*──▶ florence-auto-outreach-emails ┼─────┤
        │               (outreach engine, cron M–F    │     │
        │                12:00 UTC; holds RESEND key; │     │
        │                Places discovery; D1 direct) │     │
        └──/outreach/*─▶ florence-outreach            │     │
                        (secured Claude proxy)        │     │
                         florence-lead-followup ──────┘─────┘
                         (cron M–F 14:00 UTC, D1 direct)
   also: florence-lead-capture (form ingress), florence-utm-inject (site edge),
   fsc-api-canary (health canary), d1-backup, kb-search
```

**Repo layout:** every worker lives in `worker/<name>/` with its own
`wrangler.toml`, README, and a path-filtered GitHub Actions deploy workflow in
`.github/workflows/`. The React dashboard is the repo root (`src/`), built
with Vite and published to the `florence-dashboard` Cloudflare Pages project.

## Intended vs. actual — now aligned

| Component | Intended | Status after the 2026-07 rebuild |
|---|---|---|
| Prospect discovery | Find local operators via Google Places, auto-find email | ✅ Automated daily in the engine (server-side Places, D1-first email lookup, then website scrape). Dashboard manual search still works. |
| `florence-auto-outreach-emails` | Daily cron: enroll due prospects, multi-touch Resend sequence, unsubscribe | ✅ Engine v2: discover → filter → email-find → add → enroll (zone-exclusive) → send → digest, every action logged to `outreach_log`. Sends marked only on Resend 2xx. Ships **paused**. |
| `florence-lead-followup` | Mon–Fri cron: nudge operators at 24/72/120h | ✅ v3: Brevo gone, sends via the engine's Mailer (Resend), `follow_up_N_sent` stamped **only** on confirmed delivery. |
| `florence-outreach` | Dashboard copy-gen | ✅ v2: Bearer-authenticated (validated against the CRM API) + origin allowlist. No longer an open Anthropic-key spender. `/email-search` now lives on the engine. |
| `florence-crm-api` | Hub: prospects/leads/state | ✅ Untouched behavior + v2.25.0 additions: `outreach_log`, `suppression`, `outreach-toggle`, `zones/occupancy`, `auth/check`; owner-alert email falls back to Mailer. |
| Lead intake (form + CallRail) | Capture + assign by zone | ✅ Unchanged (verified untouched). |

## The daily automation flow (engine)

Cron **Mon–Fri 12:00 UTC (8:00 AM ET)** on `florence-auto-outreach-emails`.
Phases self-chain over HTTP so each gets a fresh subrequest budget:

1. **discover** — Google Places text search (3 queries × 2 verticals:
   `dumpster`, `hauling`) biased to 50 km around Florence (34.1954, −79.7626).
   Cheap filters run here; survivors land in the `outreach_queue` D1 table.
2. **process** (batches of 6) — scrape the operator's website for an email
   (homepage + contact page, `mailto:` + regex, role addresses preferred — no
   paid APIs), reject the uncontactable, `POST /prospects` to the CRM, set
   `default_zone`, and **enroll** into the 5-touch sequence *only if*: an
   email was found, the address isn't suppressed, and the zone is open for
   that vertical (one operator per zone).
3. **send** — pulls `/due-actions`, checks the **suppression list before every
   send**, sends via Resend with the CAN-SPAM footer + one-click
   `List-Unsubscribe` headers, and advances sequence state **only after Resend
   returns 2xx** (failures log + retry next run). Cap 10 emails/run, 1.5 s
   between sends. Skipped entirely while paused.
4. **digest** — emails Charlie a summary (added / rejected with reasons /
   sent / failed / unsubscribes / zone board / errors) — **every run, even
   when paused**, so a silent day is itself an alarm.

### Auto-reject filters (each rejection logged with its reason)

| reason | what it catches |
|---|---|
| `leadgen_or_directory` | Angi, Thumbtack, Yelp, Networx, HomeAdvisor…, or name/site containing “leads”, “marketing”, “SEO”, “directory”, agencies |
| `national_chain_or_franchise` | Waste Management, Republic, Waste Connections, GFL, 1-800-GOT-JUNK, College Hunks, Budget Dumpster & other broker/franchise domains |
| `outside_service_area` | address doesn't map to zones 1–7 (ZIP/city table shared with the CRM) |
| `uncontactable_no_phone_no_email` | no phone from Places **and** no email found by scraping |
| `duplicate_name_phone` / `already_prospect` | dedupe by `place_id` and normalized name+phone; existing prospects/partners always skipped |

### Zones

1 Florence · 2 Grand Strand · 3 Georgetown/Williamsburg · 4 Darlington County
· 5 Marion/Dillon · 6 Chesterfield/Marlboro · 7 Sumter/Lee/Clarendon.
Exclusivity is enforced **per (zone, vertical)** against prospects with
`operator_status` in `active`/`pilot_active`. Live board: dashboard →
Outreach Engine → 🤖 Automation, or `GET /zones/occupancy` on the CRM API.

## Kill switch (two layers — ships PAUSED)

- **Soft (day-to-day):** D1 `data_store.outreach_toggle`. Flip it from the
  dashboard (🤖 Automation → Pause/Un-pause) or
  `POST https://api.florencescservices.com/outreach-toggle {"paused":false}`
  (Bearer CRM token). Missing row ⇒ **paused** — the engine fails safe and
  never cold-emails until explicitly un-paused.
- **Hard:** `OUTREACH_PAUSED` var in the engine's `wrangler.toml` — set
  `"true"` and deploy to force-stop sends regardless of the toggle.

While paused the engine still discovers, adds, and enrolls (a fully-logged
live dry-run) and still sends the digest — it just never emails a prospect.

## Email rules

- **Resend only** (`RESEND_API_KEY` lives on the engine worker alone; every
  other worker sends through the engine's `Mailer` service-binding RPC, which
  also runs the suppression check). Brevo/SendGrid are fully removed.
- Sender: `charlie@florencescservices.com` (domain verified in Resend).
- **CAN-SPAM:** postal address in every footer, one-click `List-Unsubscribe`
  header + `/unsubscribe` endpoint (HMAC-signed links), opt-outs stored
  permanently in the `suppression` table and checked before **every** send.
- **A message is marked sent only on a Resend 2xx.** Failures are logged to
  `outreach_log` and the sequence state is left untouched so the step retries
  on the next run.

## The 5-touch sequence (dumpster copy; hauling swaps the nouns)

Spacing: day 0 / 2 / 5 / 8 / 12. Personalized per prospect: first name,
company, zone label, zone city. Render anytime:
`GET /preview?vertical=dumpster|hauling` on the engine (auth), or dashboard →
🤖 Automation → Sequence Preview. Every email carries the footer
(`Florence SC Services · 10685-B Hazelhurst Dr. #43191, Houston, TX 77043 ·
(833) 968-3306` + unsubscribe link).

**1 · Day 0 — “dumpster leads in florence”**
> Hi {first},
>
> I run florencescservices.com — Google "dumpster rental Florence SC" and
> you'll find me on page one. People needing a dumpster in {the Florence
> zone} land there every week, and right now I have no local operator to send
> them to.
>
> The model is simple: one operator per zone, period. Nothing gets blasted to
> five companies the way Angi does it. A lead from your area goes to you and
> nobody else.
>
> Your first month is free — no card, no contract. Work the leads, keep the
> jobs, then decide if it's worth paying for.
>
> Want {Company} to be where {the Florence zone} leads go? Reply "yes" and
> it's yours.
>
> Charlie — Florence SC Services · (833) 968-3306

**2 · Day 2 — “re: dumpster leads in florence”**
> Hi {first},
>
> Quick follow-up — {the Florence zone} is still open on my end, which means
> dumpster requests from there are coming in with no local operator attached.
>
> The free month starts whenever you say the word. No card, no contract, just
> leads while you decide if they're any good.
>
> Worth a look?
>
> Charlie

**3 · Day 5 — “not another angi pitch”**
> Hi {first},
>
> You've probably been burned by lead sites: pay up front, then race four
> other companies to a phone number they all bought. I built the opposite.
>
> When someone finds my site needing a dumpster in {the Florence zone}, that
> lead goes to one operator. If that's you, it's you every time. No shared
> leads, no bidding, no pay-per-dud.
>
> It's also why I can only take one company per zone — and why {the Florence
> zone} being open right now actually means something.
>
> First month's free to prove it. Reply and I'll set {Company} up.
>
> Charlie

**4 · Day 8 — “what one lead turned into”**
> Hi {first},
>
> Real number: back in March I sent a partner a single lead — he closed a
> $400 dumpster rental off it within two hours. One lead, one job, nobody
> else calling that customer.
>
> I bring it up because {the Florence zone} is still unclaimed, and I pitch
> every operator in the area eventually. Zones are first come, first serve —
> whoever claims one locks it, free month included, and everyone else in that
> zone is out of luck.
>
> I'd rather it be {Company}. Reply "claim it" and {the Florence zone} comes
> off the market.
>
> Charlie

**5 · Day 12 — “closing the loop”**
> Hi {first},
>
> Last note from me — you run a real business and I'm not going to keep
> cluttering the inbox.
>
> The offer stands while {the Florence zone} stays open: exclusive dumpster
> leads, one operator per zone, first month free, no card, no contract. The
> day someone else claims it, it's gone and you won't hear about it from me
> again.
>
> If it's ever a fit, just reply. Either way — busy season to you.
>
> Charlie — Florence SC Services

The engine auto-sends only these two email sequences (`new_prospect`,
`hauling_new_prospect`). The dashboard's re-engage / free-month-follow-up
sequences are Charlie-driven (calls/SMS with copy buttons) — same offer
language, updated in-app.

## Data (D1 `florence-crm`, id `50e1fc12-682d-4d58-8506-93687a10dc36`)

Existing tables unchanged: `prospects`, `leads`, `lead_events`,
`outreach_state`, `activities`, `memory`, `data_store`, …

New (self-ensured by the workers, idempotent):

- **`outreach_log`** — the audit trail. One row per action:
  `run_started`, `discovered`, `rejected` (+reason), `added`, `enrolled`,
  `added_not_enrolled`, `email_sent` (+Resend id), `email_failed`,
  `email_suppressed`, `unsubscribed`, `sends_skipped`, `toggle`,
  `digest_sent`, `error`, `run_finished`. Query via the dashboard, the
  engine's `GET /outreach-log`, or the CRM's `GET /outreach-log` /
  `GET /outreach-log/summary?day=`.
- **`suppression`** — permanent opt-outs (`email` PK, reason, prospect_id).
  CRM endpoints: `GET/POST/DELETE /suppression`, check with
  `GET /suppression?email=x`.
- **`outreach_queue`** — engine-internal discovery queue (pending/done/
  rejected/error per `place_id`); also the “never re-log the same rejection”
  memory.

## Endpoints

**Engine — `https://florence-auto-outreach-emails.cball8475.workers.dev`**
(auth = Bearer CRM token, or `ADMIN_SECRET`/`SMOKE_TOKEN`):
`GET /preflight` (public booleans) · `GET|POST /unsubscribe` (public, signed)
· `POST /trigger[?phase=|dry=1]` · `GET /preview?vertical=` ·
`POST /test-email` · `GET /status` · `GET /outreach-log` · `GET|POST /toggle`
· `POST /email-search` · `POST /stop`. Plus the `Mailer` RPC entrypoint
(service bindings only). Dashboard reaches all of it via `/engine/*`.

**CRM API — `https://api.florencescservices.com`** (Bearer `API_TOKEN`):
everything from v2.24 plus `GET /auth/check`, `GET|POST /outreach-log`,
`GET /outreach-log/summary`, `GET|POST|DELETE /suppression`,
`GET|POST /outreach-toggle`, `GET /zones/occupancy`.

**Lead-followup — `…lead-followup.cball8475.workers.dev`**: `GET /health`;
`GET /?token=` or Bearer (CRM-validated) = manual run.

**florence-outreach — `…florence-outreach.cball8475.workers.dev`**:
`POST /` (Anthropic Messages passthrough; Bearer required; dashboard uses
`/outreach/*`).

## Secrets (names only — values live in Cloudflare, never in git)

| Worker | Secrets |
|---|---|
| florence-auto-outreach-emails | `RESEND_API_KEY` (the only copy), `CRM_API_TOKEN`, `UNSUB_SECRET`, `GOOGLE_PLACES_API_KEY`*, `ADMIN_SECRET`?, `SMOKE_TOKEN` (CI-rotated) |
| florence-crm-api | `API_TOKEN`, `TWILIO_*`, `GITHUB_TOKEN`, `GOOGLE_ADS_*`, (`RESEND_API_KEY` optional — Mailer covers it) |
| florence-dashboard-proxy | `CRM_API_TOKEN` |
| florence-outreach | `ANTHROPIC_API_KEY` |
| florence-lead-followup | `MANUAL_TRIGGER_TOKEN` (legacy; `BREVO_API_KEY` obsolete — delete anytime) |

\* Until the `GOOGLE_PLACES_API_KEY` repo secret is added (see runbook), the
engine falls back to the D1 `data_store` key `google_places_api_key`.

## Runbook

- **Pause / un-pause:** dashboard → Outreach Engine → 🤖 Automation, or
  `curl -X POST https://api.florencescservices.com/outreach-toggle -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"paused":false,"reason":"go"}'`
- **Read the emails before anything sends:** 🤖 Automation → Sequence
  Preview, or `curl -H "Authorization: Bearer $TOKEN" "https://florence-auto-outreach-emails.cball8475.workers.dev/preview?vertical=dumpster"`
- **Dry run now:** 🤖 Automation → “Dry run now”, or `POST /trigger?dry=1`.
  Discovers/adds/enrolls + digest, zero prospect emails.
- **Run for real now:** `POST /trigger` (only sends if un-paused).
- **Read the logs:** 🤖 Automation activity table;
  `GET /outreach-log?event=rejected&day=YYYY-MM-DD` (engine or CRM);
  `GET /outreach-log/summary?day=…` (CRM). Cloudflare dashboard → worker →
  Logs for raw console output.
- **Check health:** engine `GET /preflight` (public); `GET /health` on
  crm-api and lead-followup.
- **Un-suppress someone** (they asked back in):
  `DELETE /suppression?email=x@y.com` on the CRM API.
- **Daily digest:** lands at charlie@florencescservices.com after every
  weekday run, paused or not. No digest = engine didn't run → check
  `/preflight`, then the Actions tab / worker logs.
- **Deploys:** push to `main`; each worker has a path-filtered workflow
  (`.github/workflows/deploy-*.yml`, repo secret `CLOUDFLARE_API_TOKEN`).
  The dashboard publishes to Cloudflare Pages via `deploy-dashboard.yml`.
- **Turn on discovery via proper secret (recommended):** add repo secret
  `GOOGLE_PLACES_API_KEY`, re-run the engine deploy workflow (it syncs it),
  then optionally delete the D1 fallback row:
  `DELETE FROM data_store WHERE key='google_places_api_key'`.
- **Turn on CRM owner-alert email redundancy:** nothing to do — alerts fall
  back to the engine's Mailer automatically. Adding a `RESEND_API_KEY` repo
  secret and re-running deploy-worker.yml also puts a direct copy on the hub.

## Costs & limits

Places Text Search (Pro fields) ≈ 6 requests/weekday — comfortably inside
Google's free monthly tier. Resend: ≤10 outreach sends/run + digest ≈
well under the free 100/day. Workers are on the paid plan (Vectorize/kb-search
already required it).

## What still needs Charlie (one-time)

1. **Un-pause** when ready for the first real sends (after reviewing a digest
   + previews): the system ships paused by design.
2. GitHub → site-admin → Settings → Secrets → add **`GOOGLE_PLACES_API_KEY`**
   (value in your password store; same key the dashboard uses) and — in
   Google Cloud Console — restrict that key to the **Places API** only.
3. Optionally add **`RESEND_API_KEY`** repo secret (hub gets its own copy).
4. **Rotate the temporary Cloudflare Account API token** used for the July
   2026 build session (dash → Manage Account → Account API Tokens).
5. Merge `claude/new-session-1nif9k` → `main` so the per-worker CI workflows
   register.
