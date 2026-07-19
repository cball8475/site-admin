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

## 2026-07-19 — Reply ingestion worker deployed (email-reply-ingest)

New Email Worker `email-reply-ingest` (source: `worker/email-reply-ingest/`,
auto-deploys via deploy-email-ingest.yml): on inbound mail it matches the
sender against `prospects`, logs a `reply` activity with a body excerpt,
halts the sequence, suppresses the address (`replied_auto`), writes
`reply_received` to outreach_log, then forwards to the owner inbox
(FORWARD_TO var, default cball8475@gmail.com). Non-prospect mail is logged as
`inbound_nonprospect` and forwarded. **NOT ACTIVE until Charlie flips Email
Routing** (session tokens lack zone Email Routing perms): Cloudflare dash →
florencescservices.com → Email → Email Routing → Routing rules → edit the
info@/charlie@ rules (or catch-all) → Action "Send to a Worker" →
email-reply-ingest. Forwarding is preserved, so inbox behavior is unchanged.

## 2026-07-19 — Dashboard was locked out of CRM (token drift) + SOMO Trash trial accepted

### Root cause of the stale dashboard (outreach/pipeline/prospects tabs)
The Netlify-built dashboard's baked `VITE_CRM_API_TOKEN` (set Jun 5) no longer
matched the worker's `API_TOKEN` → every authed call to
`api.florencescservices.com` returned 401 → tabs silently fell back to seed
data. The outreach engine kept working the whole time (it writes to D1 directly
and its own `CRM_API_TOKEN` was valid), so data was current in D1 but invisible.
The fsc-credentials registry's CRM bearer was ALSO stale (second consumer missed
by an earlier rotation) — **Charlie: update the fsc-credentials skill registry;
the CRM API Bearer it lists is dead.**

### Token rotation (2026-07-19, no values here — public repo)
`API_TOKEN` rotated on florence-crm-api and synced to ALL consumers in one
sweep: florence-auto-outreach-emails + florence-dashboard-proxy +
florence-lead-capture (`CRM_API_TOKEN` each) and Netlify `VITE_CRM_API_TOKEN`
(env var updated + rebuild triggered via deploy-trigger.txt). Verified live:
new token returns 200/12 prospects. **Rotation SOP: these 5 consumers, always
all of them, then a Netlify rebuild — a missed consumer is exactly how the
dashboard broke.**

### SOMO Trash LLC — junk-hauling trial ACCEPTED (2nd hauling operator)
Chestly Morris (info@somotrash.com) replied Wed 2026-07-15 8:31 AM ET:
*"We will try it for the first month. What do the costs look like after
month 1?"* — recorded in CRM 07-19: stage `contacted → pilot_active`,
`operator_status=active`, vertical hauling, Zone 4 (Darlington), sequence
halted, email suppressed (`replied_positive`). **Open item: Charlie owes
Chestly an answer on month-2+ pricing.** Note: the engine auto-sent the
"Not-Angi" step3 email 3.5h AFTER the acceptance — replies are not ingested
anywhere (they land in an inbox only; sender shows via cloudflare-email.net).
Known gap: build reply ingestion (Cloudflare Email Routing worker → CRM
activity + auto-suppress + owner alert) so a reply always halts the sequence
same-day. Active hauling operators now: Kaylor Junk Removal (Zone 7),
SOMO Trash (Zone 4).

## 2026-07-19 — CallRail Voice Assist trial #2: intake-based spam gate (v2.26.0)

New 14-day Voice Assist trial. Instead of restoring the trial-era duration
bump (38→40s), the webhook history showed duration is the wrong signal, so the
spam gate was rewritten to key on captured intake.

### What the webhook history proved (D1 `lead_events` where `event_type='callrail_raw'`)
Only 3 raw payloads on record (spam-filtered calls never insert a lead, so they
aren't logged). They cleanly separate real from junk **by intake, not length**:
- Lead **91** (David Ball, 120s) & **92** (Jim Newton, 109s): `answered=true`,
  tag "Voice Assist - Message Taken", full `voice_assist_message.contents`
  (name, purpose, product_service_interest, size, days). Real leads.
- Lead **101** ("Pawleys Is Sc", 41s): `answered=false`, `call_type=voicemail`,
  **no `voice_assist_message`**, no name/service/ZIP — yet it PASSED the old 38s
  filter and fired a wasted owner alert. Raising to 40s would not have caught it.

### Confirmed Voice Assist payload field names (no more guessing)
- `body.voice_assist_message.contents` (and `.ordered_content_with_overrides`)
  → `name`, `purpose`, `product_service_interest`, `contact_preference`,
  `phone_number`, `custom_question_1` (size), `custom_question_2` (days).
- `body.answered` (bool), `body.call_type` ("answered" | "voicemail"),
  `body.tags` (includes "Voice Assist - Message Taken").
- **ZIP is NOT a structured field** — it lives in `call_summary` text; the
  worker's regex scan pulls it (29501, 29505 captured correctly).

### The new gate (handleCallRailWebhook)
`hasVoiceAssistIntake = product_service_interest || name || purpose || detected
service`. Keep any call with intake regardless of duration; drop no-intake calls
that are voicemail/unanswered or under `SPAM_MIN_DURATION` (38s). Verified against
all 3 payloads: 101→drop, 91/92→keep. Post-trial (VA off) it reduces to the
original 38s filter, so nothing breaks when the trial ends — no revert needed.

### Repo/live drift caught + fixed (important)
Production had drifted to **v2.25.0 while the repo was v2.24.0** — the live
bundle carried uncommitted features (outreach logging: `/outreach-log`,
`/outreach-toggle`, `/suppression`; plus `/auth/check`, `/zones/occupancy`,
`ZONE_NAMES`). A naive deploy-from-repo would have **wiped those from prod**.
Fixed by syncing `src/index.js` to the live bundle first (commit "sync repo
source to live deployed bundle"), then applying the gate on top. **Lesson:
`wrangler deploy` pushes `src/index.js` verbatim and the repo can lag live —
pull the deployed bundle and diff before deploying.**

### CallRail account side (Charlie confirmed via dashboard screenshot)
Voice Assist already enabled on **6/6 tracking numbers**; Business profile / AI
voice / Lead intake questions carried over from trial #1. "Text messages"
(VA's own post-call SMS) left **Inactive** on purpose — the worker already texts
customers via `sendCustomerSMS`, so enabling it would double-text.

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
- **Spam gate is intake-based as of v2.26.0** (was a plain `SPAM_MIN_DURATION`
  duration cutoff). A CallRail call becomes a lead if Voice Assist captured
  real intake (service/name/purpose) — *regardless of call length*. Calls with
  no intake are dropped only when they're voicemail/unanswered or under 38s.
  When Voice Assist is off, no intake is ever present, so it reduces to the old
  38s duration filter. Remember this before debugging "missing" call leads.

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
