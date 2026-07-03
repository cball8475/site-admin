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

## 2026-07-03 — "Site admin doesn't load" = Access lockout; charlie@ inbound email dead since ~Apr 21

### Root cause chain (app itself is healthy)
- `dashboard.florencescservices.com` is the site admin. Serving chain:
  `florence-dashboard-proxy` worker → `florence-dashboard.pages.dev` (frontend)
  and `/api/*` → `api.florencescservices.com` (worker attaches the bearer).
- The hostname sits behind **Cloudflare Access** (app named `florence-crm-api`,
  org `florencesc.cloudflareaccess.com`) using One-time PIN login as
  **charlie@florencescservices.com**.
- Access does send the PIN email, but it never arrives: **Cloudflare Email
  Routing forwarding of charlie@florencescservices.com → cball8475@gmail.com
  stopped working ~2026-04-21.** Gmail shows hundreds of forwarded charlie@
  emails up to Apr 21 and zero after Apr 22. Outbound mail still works
  (Gmail "send as" alias), which masked the breakage for months.
- Net effect: login can never complete → dashboard "doesn't load".
- Verified healthy while diagnosing: Pages deploy + JS bundle (API base
  `/api`, no token baked in — correct), CRM API `/health` 200 (v2.24.0),
  DNS (MX still `route1-3.mx.cloudflare.net`), public site unaffected.

### Bigger than the dashboard
ALL inbound mail to charlie@ — prospect replies, 2FA codes, Nextdoor — has
been black-holed since late April. Check the Email Routing activity log for
what was dropped.

### Fix (owner task, Cloudflare dashboard — sessions have no CF credentials)
1. Cloudflare dash → `florencescservices.com` zone → **Email → Email
   Routing**: re-verify the destination address (cball8475@gmail.com) and
   re-enable the charlie@ rule (rules auto-disable when the destination
   becomes unverified). Check the activity log.
2. Quick unblock for the dashboard alone: Zero Trust → Access → Applications
   → `florence-crm-api` → add an Include → Emails → cball8475@gmail.com to
   the allow policy (that inbox receives fine).

### Diagnostic tricks that worked (reusable)
- Cloudflare Access shows "a code has been emailed" even when it silently
  sends nothing (unauthorized email) — you cannot distinguish policy-reject
  from delivery failure at the login page.
- Differential control: request an OTP for `eaton-ehs-cmd.pages.dev` (same
  Access org) — it arrives at cball8475@gmail.com within seconds. If that
  arrives and the dashboard one doesn't, the problem is app-policy/delivery,
  not Cloudflare-wide.
- The Access login flow is plain curl-able: GET the login URL, POST
  `email=` to the `verify-code` form action (keep a cookie jar), then POST
  the emailed `code` + `nonce`.
- `florence-dashboard-proxy.cball8475.workers.dev` returning
  `error code: 1042` is a red herring — workers.dev-invoked workers can't
  fetch same-account `pages.dev`/worker hostnames; the custom-domain path is
  what matters in production.

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
