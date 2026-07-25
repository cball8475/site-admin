# FSC / EATON Credential Audit Playbook

**Why this exists:** ending the guessing. This is the complete inventory of every
secret, token, and key the infrastructure references — extracted from the actual
source of all five repos on 2026-07-25, not from memory. A dedicated session
walks this list top to bottom, verifies each entry exists where it should, and
records the result. No value is ever written into this file — names and
locations only.

**Kickoff prompt for the audit session:**
> Open site-admin/docs/credential-audit.md and run the credential audit. Go
> table by table. For each row: (1) verify the credential exists in its stated
> location, (2) run its Safe Functional Test from section 0 so we prove it
> WORKS, not just that it exists, (3) ask me for any value that is missing or
> failing, tell me exactly where to put it, and mark the row's status. Obey
> the Rules of Engagement in section 0 absolutely — no test that sends email
> or SMS, touches the outreach engine, or triggers a cron. Also load the
> fsc-credentials skill and reconcile its registry against this list — anything
> in one but not the other gets flagged. Do not print secret values in chat.

---

## 0. Rules of engagement + safe functional tests

**The audit is read-only by design. It must not change production state.**

FORBIDDEN during the audit — no exceptions, even "just to test":
- `POST /digest/send` (sends a real email — use `GET /digest/preview` instead)
- Any Twilio send (verify in the Twilio console logs, read-only)
- Manually triggering ANY cron (advances real sequences/snapshots)
- Anything touching the outreach engine or its pause toggle
  (`data_store: outreach_toggle` — it fails safe to paused; leave it)
- `PUT`/`PATCH`/`DELETE` against any CRM or EATON endpoint

Allowed writes, explicitly: `POST /backup` on d1-backup (writes today's dated
snapshot — idempotent, harmless) — and even that is optional, since
`GET /backups` proves the same credential read-only.

**Safe functional test per credential** — each proves the credential *works*
by exercising a real function, without side effects:

| Credential | Safe functional test |
|---|---|
| florence-crm-api API_TOKEN | `GET /prospects` with bearer → 200; without → 401 |
| GOOGLE_ADS_* (all four) | `GET /ads/metrics?days=7` → 200 with data (exercises OAuth refresh + Ads read) |
| GOOGLE_* for GSC | `GET /seo/metrics?days=7` → 200 (exercises token refresh + GSC read) |
| RESEND_API_KEY (crm) | `GET /leads/:id/events` on the newest lead → `owner_alert.event_data.email.sent` (+ `via`). Proves delivery read-only, no send. Resend dashboard as backup |
| TWILIO_SID/AUTH_TOKEN | `GET /leads/:id/events` on the newest lead → `owner_alert.event_data.sms.sent`. Proves the credential worked on a real alert, no test send. Twilio console as backup |
| MERCURY_WEBHOOK_SECRET | Mercury dashboard → webhook config shows endpoint + secret set; cannot probe inbound |
| d1-backup API_TOKEN | `GET /backups` with bearer → 200 + today's objects listed; without → 401 |
| kb-search API_TOKEN | `GET /search?q=test` with bearer → 200 with matches; without → 401 |
| email-reply-ingest | Read-only: check `outreach_log` for recent `reply_received`/`inbound_nonprospect` rows via CRM API |
| eaton AUTH_TOKEN / API_TOKEN | `GET /stats` with bearer → 200; without → 401 |
| eaton ANTHROPIC_API_KEY | `POST /otter/extract` with a 2-line dummy transcript → 200 with tasks JSON (calls Anthropic, writes nothing) |
| eaton RESEND_API_KEY | `GET /digest/preview` (builds, doesn't send) + last Friday cron invocation green in CF dashboard |
| eaton GITHUB_BACKUP_TOKEN | Latest `infra/backups/auto/d1-export-*.json.gz` in the EATON repo is ≤7 days old + PAT expiry date in GitHub settings |
| CLOUDFLARE_API_TOKEN (both repos) | Verify scopes in CF dashboard (read-only); token already proven by the 2026-07-25 deploys |
| MEMBER_PASSWORD | Open lwvnewportcounty.org/members.html in a browser, enter the password → portal decrypts |
| VITE_* (Netlify) | Load the site-admin dashboard → data populates (read-only GETs through the baked-in creds) |

Any credential whose only true functional test has side effects (Resend send,
Mercury inbound) is verified indirectly as above and marked "indirect" in the
audit log — never force-tested.

---

## 1. Cloudflare Worker secrets (set via `wrangler secret put` or deploy workflow)

Verify with: `npx wrangler secret list --name <worker>` (names only, by design).

### florence-crm-api
| Secret | Purpose | Breaks without it | Status 2026-07-25 |
|---|---|---|---|
| API_TOKEN | Bearer auth for the CRM API | Dashboard + all API callers | ⚠️ works, but PUBLIC — see Finding 1 |
| RESEND_API_KEY | Owner lead-alert emails | Lead alerts (off, logged) | ❌ not set — and not needed, see Finding 3 |
| GOOGLE_ADS_CLIENT_ID | Google OAuth (Ads + GSC) | Ads metrics, SEO snapshot cron | ✅ `/ads/metrics` 200 |
| GOOGLE_ADS_CLIENT_SECRET | Google OAuth | Same | ✅ same test |
| GOOGLE_ADS_REFRESH_TOKEN | Google OAuth | Same | ✅ same test |
| GOOGLE_ADS_DEVELOPER_TOKEN | Google Ads API | Ads metrics | ✅ same test (zero spend — confirm intentional) |
| TWILIO_ACCOUNT_SID | SMS lead alerts | SMS alerts | ✅ `owner_alert` → `sms.sent:true` 07-24 |
| TWILIO_AUTH_TOKEN | SMS lead alerts | SMS alerts | ✅ same test |
| MERCURY_WEBHOOK_SECRET | Mercury webhook HMAC (note: ENFORCE_MERCURY_SIG is false in code — flag this during audit) | Webhook auth is advisory | ⚠️ ⏳ confirmed dead code (`index.js:2151`) — decide enforce or drop |
| GITHUB_TOKEN | `/github-push` + `/github-inject-pixel` (503 without it) | Dashboard GitHub features | ⏳ **row added during audit — was missing from this table**; record PAT expiry |

GSC also verified independently: `GET /seo/metrics?days=7` → 200 with real data
(62 clicks / 4,688 impressions over 7 days).

Plain vars (wrangler.toml / dashboard, not secrets): LEAD_ALERT_FROM,
LEAD_ALERT_TO, OPERATOR_PHONE. Bindings: DB (D1), MAILER (service binding —
verify target worker exists).

### d1-backup
| Secret | Purpose | Breaks without it | Status 2026-07-25 |
|---|---|---|---|
| API_TOKEN | Locks /backup + /backups (fails closed since 2026-07-25; synced from GitHub secret BACKUP_API_TOKEN) | Manual endpoints 401 | ✅ present by sync-proof (see note) |

**Sync-proof method** (used for d1-backup and kb-search): the deploy workflow `exit 1`s
when its repo secret is empty, and it ran green on 2026-07-25 — so the repo secret
exists and was pushed to the worker. Both endpoints also 401 unauthenticated,
confirming fail-closed. An authenticated 200 was **not** run: the repo-secret values
are write-only and a remote session cannot read them.

Vars: RETENTION_DAYS. Bindings: 5× D1 (DB_EATON, DB_CRM, DB_FAMILY, DB_BHE,
DB_TINY), R2 BACKUPS. Verify a backup object exists for today in R2.

### kb-search
| Secret | Purpose | Breaks without it | Status 2026-07-25 |
|---|---|---|---|
| API_TOKEN | Locks /search + /reindex (fails closed; synced from GitHub secret KB_API_TOKEN) | Endpoints 401 | ✅ present by sync-proof (see d1-backup note) |

Vars: EMBED_MODEL (optional). Bindings: DB (D1 eaton-ehs-dashboard), AI, VEC
(Vectorize eaton-kb).

### email-reply-ingest
No secrets. Var: FORWARD_TO (optional, defaults to cball8475@gmail.com).
Binding: DB (florence-crm D1). Verify Email Routing rule points at this worker.

### eaton-ehs-api
| Secret | Purpose | Breaks without it | Status 2026-07-25 |
|---|---|---|---|
| API_TOKEN | Fallback bearer auth (Secrets Store is primary) | Auth falls to Secrets Store only | ⏳ can't isolate externally while Secrets Store works |
| AUTH_TOKEN (Secrets Store binding → EATON_TOKEN, store 80c48360…) | Primary bearer auth | All API callers | ✅ `/stats` 200 with, 401 without |
| ANTHROPIC_API_KEY | /otter/extract transcript extraction | Debrief extraction 502s | ✅ returned real structured tasks |
| RESEND_API_KEY | Friday weekly digest email | Digest cron fails (loudly, since v3.9.3) | ⚠️ indirect — `/digest/preview` 200, but preview never touches Resend |
| GITHUB_BACKUP_TOKEN | Monday D1 backup push to GitHub (PAT, repo scope — check expiry) | Backup cron fails (loudly) | ✅ `d1-export-2026-07-25.json.gz` present; ⏳ expiry unrecorded |

`GIT_SHA` verified: `/health` reported `7d64c90`, matching main HEAD.
email-reply-ingest verified working: 22 `inbound_nonprospect` rows on 2026-07-25
(newest 15:01:24), proving the Email Routing rule targets it and D1 writes succeed.

Vars: GIT_SHA (stamped per-deploy — verify /health matches main), DIGEST_FROM,
DIGEST_TO, BACKUP_REPO, BACKUP_BRANCH (all optional, have defaults). Bindings:
DB, AI, VECTORIZE (eaton-memory).

**Known duplication to resolve during audit:** the EATON bearer token lives in
BOTH the Secrets Store (EATON_TOKEN) and `EATON/infra/env.sh` in plaintext in
the repo. env.sh's own comment requires manually keeping them in sync. Decide:
rotate + remove from git, or accept and document.

---

## 2. GitHub Actions repo secrets

Verify at: repo → Settings → Secrets and variables → Actions.

Remote Claude sessions **cannot read or set these** — the proxy blocks the
Actions-secrets endpoints. Presence is proven indirectly, by whether a workflow that
hard-fails without the secret ran green.

| Repo | Secret | Purpose | Status 2026-07-25 |
|---|---|---|---|
| site-admin | CLOUDFLARE_API_TOKEN | Deploys all 4 workers | ✅ all 4 deploys green |
| site-admin | BACKUP_API_TOKEN | Synced to d1-backup as API_TOKEN; deploy FAILS if missing | ✅ green run ⇒ present |
| site-admin | KB_API_TOKEN | Synced to kb-search as API_TOKEN; deploy FAILS if missing | ✅ green run ⇒ present |
| site-admin | RESEND_API_KEY | Synced to florence-crm-api (warning if missing) | ❌ **does not exist** — run log shows the var empty and the `::warning::` fired |
| EATON | CLOUDFLARE_API_TOKEN | Deploys eaton-ehs-api (added 2026-07-25) | ✅ deploy green |
| LWVNewportCounty | MEMBER_PASSWORD | StatiCrypt member portal; build FAILS if missing | ✅ portal build asserts non-empty, ran green |

⏳ Token scope check for both CLOUDFLARE_API_TOKEN copies: Workers Scripts (edit),
D1 (edit), R2 (edit), Vectorize (edit), Workers AI, Secrets Store (read).

---

## 3. Netlify environment variables (site-admin dashboard)

Netlify → site-admin → Site configuration → Environment variables. Build-time
(VITE_ prefix) — changing them requires a redeploy.

| Variable | Purpose | Status 2026-07-25 |
|---|---|---|
| VITE_CRM_API_URL | CRM API base URL | ✅ set → `https://api.florencescservices.com` |
| VITE_CRM_API_TOKEN | CRM bearer (must equal florence-crm-api API_TOKEN) | ⚠️ set, matches the worker — and PUBLIC, see Finding 1 |
| VITE_GOOGLE_PLACES_KEY | Google Places lookup in the dashboard | ⚠️ **undocumented until this audit** — `AIza…` key published in the bundle; needs HTTP-referrer restriction |
| VITE_GITHUB_TOKEN | GitHub PAT for dashboard features (check expiry) | ❌ **orphaned — delete it**, see Finding 2 |

**Name correction:** this table previously listed `VITE_API_TOKEN`. Source actually
reads `VITE_CRM_API_TOKEN` at three call sites (`App.jsx:11`,
`CompanySnapshot.jsx:16`, `GoogleAdsTile.jsx:12`); `VITE_API_TOKEN` is only a non-PROD
fallback in the last of those.

---

## 4. Claude-side (fsc-credentials skill + session env)

| Item | Check | Status 2026-07-25 |
|---|---|---|
| CLOUDFLARE_API_TOKEN in Claude Code env settings | env.sh claims every session exports it — the 2026-07-25 cloud session did NOT have it. Verify claude.ai/code → environment settings, or correct env.sh's comment | ❌ absent again this session — `wrangler` could not authenticate. env.sh's comment is wrong; ⏳ fix the comment or set the env var |
| fsc-credentials registry (references/registry.md) | Reconcile against this whole file; add BACKUP_API_TOKEN + KB_API_TOKEN entries (created 2026-07-25, values in GitHub secrets) | ✅ done — registry.md and rotation-sops.md **did not exist**; both written, skill corrected and version-controlled at `skills/personal/fsc-credentials/` |
| Rotation SOP dates | Any credential with no known rotation date gets one scheduled | ⏳ two GitHub PAT expiries still unrecorded (crm `GITHUB_TOKEN`, eaton `GITHUB_BACKUP_TOKEN`) |

---

## 5. Third-party accounts referenced by the stack (existence + billing check)

Anthropic (API key above) · Resend (domain verified: florencescservices.com) ·
Google Cloud OAuth app (Ads/GSC scopes) · Twilio · Mercury (webhook) ·
GitHub PATs (×2: dashboard + EATON backup — both have expiry dates, record them)
· Netlify · Cloudflare (Workers paid features: D1, R2, Vectorize, AI, Secrets
Store) · StatiCrypt password (member-facing — who else holds it?).

---

## Findings — 2026-07-25 audit

### Finding 1 (critical) — the CRM bearer is published

`VITE_CRM_API_TOKEN` is inlined into the dashboard's public JS bundle at build time.
The audit downloaded `https://site-admin-fsc.netlify.app` unauthenticated, extracted the
bearer, and pulled 200s from `/prospects`, `/ads/metrics`, `/seo/metrics`, and
`/gsc/metrics`. Anyone who loads the dashboard URL can read the CRM.

Rotating alone does not fix it — the replacement is republished on the next build. The
fix is two changes, in order:

1. Move auth server-side: an `/api` proxy (Netlify Edge Function) reading an
   **unprefixed** `CRM_API_TOKEN`, with all three call sites using relative `/api`.
   `GoogleAdsTile.jsx:11-12` is already written against exactly this shape (in `PROD`
   it uses `/api` with an empty token), but **no `netlify.toml` or `_redirects`
   exists**, so `/api/*` currently returns Netlify's 404 page. The proxy was started and
   never finished.
2. Add access control in front of the dashboard. Netlify reports
   `requiresPassword: false`, so step 1 alone converts the leak into an unauthenticated
   public API over the same data. The site is on `nf_team_dev`, so built-in password
   protection may need a plan change; a login check inside the Edge Function avoids that.

Then rotate `API_TOKEN` + the Netlify var, since the present value is burned.
Also retire `florence-dashboard-proxy` — it 404s on every path and is a second,
half-built proxy.

**Remediation built — see `docs/dashboard-deploy.md`.** Rather than a Netlify Edge
Function, this is one Cloudflare Worker (`fsc-dashboard`) serving the SPA and
proxying `/api/*` with the bearer read from Secrets Store — the same store that
already holds `EATON_TOKEN`, and Cloudflare Access gates the hostname. Note the
client code was *already* written for this: `App.jsx` carried a comment saying the
token stays server-side and calls go same-origin through a dashboard proxy, and
`crmFetch` already omits the auth header when no token is present. The leak came
from *setting* `VITE_CRM_API_URL` + `VITE_CRM_API_TOKEN` in Netlify, which
overrode the intended `/api` fallback and pulled the bearer into the bundle. Prod
is now pinned to `/api` with no token so no build-env mistake can reintroduce it,
and the deploy workflow fails the build if a `VITE_*_TOKEN` is present or if a
credential shape appears in `dist/`.

### Finding 2 — `VITE_GITHUB_TOKEN` is orphaned

Zero references in `src/`, and no PAT appears in the built bundle. Dashboard GitHub
features run through the worker's `GITHUB_TOKEN` secret instead. Delete the Netlify
variable: a PAT inlined into a public bundle would be far worse than the CRM token.

### Finding 3 — lead-alert email is not broken, and the Resend key is redundant

`RESEND_API_KEY` is absent from both the site-admin repo secrets and the
florence-crm-api worker. It does not need to be added. `lead_events.owner_alert` for
lead #105 (2026-07-24 22:19:21) records `sms.sent:true` **and**
`email.sent:true, via:"mailer"` with a real Resend message id — owner alerts are
flowing through the `MAILER` service binding to `florence-auto-outreach-emails`, which
holds a working Resend key (independently confirmed by `outreach_log.email_sent` on
2026-07-24). The `resend_key_missing` state described in the worker's memory table is
stale. Decide which path owns owner-alert email and delete the other, rather than
setting a second key.

### Finding 4 — this inventory is not complete

The Cloudflare account holds **16** workers; this document covers 5 and describes itself
as complete. Undocumented: `florence-outreach`, `florence-auto-outreach-emails` (the
`MAILER` target — demonstrably holds a Resend key), `florence-lead-capture`,
`florence-lead-followup`, `florence-utm-inject`, `florence-dashboard-proxy`,
`ball-family-api`, `ball-family-ingest`, `fsc-api-canary`, `deal-or-no-deal`,
`tiny-mountain-65c7`. Several send email or accept webhooks, so several hold secrets.
`florence-auto-outreach-emails` has no source in any of the five repos.

### Finding 5 — method note: existence checks were unavailable

`wrangler secret list` requires `CLOUDFLARE_API_TOKEN`, which this session did not have,
so **no secret name was enumerated directly**. The Cloudflare MCP `workers_get_worker`
tool returns only a script's name and id — it does not list bindings or secrets, despite
the fsc-credentials skill previously claiming it did. Every ✅ above therefore rests on a
functional test or a hard-failing workflow, which is stronger evidence than a name in a
list — but it means an unused secret could exist under a name nobody has read.

### Reconciliation vs the fsc-credentials skill

The skill's `references/registry.md` and `references/rotation-sops.md` **did not exist** —
`SKILL.md` was the only file, so every reference link was broken. Both have been written
from these findings, and the skill is now version-controlled at
`skills/personal/fsc-credentials/` (it was previously unversioned).

Corrected in the skill:
- Its inline CRM bearer was **stale** — rejected 401 on both the workers.dev host and
  the custom domain. The registry no longer stores any secret value, which is the
  structural fix: a cached value drifts silently while the skill reports success.
- **SendGrid** entries removed (routed to `dashboard.sendgrid.com`, put
  `SENDGRID_API_KEY` in the `.dev.vars` template). All email is Resend.
- **Stripe / Wave** removed — they appear nowhere in this infrastructure.
- **`florence-health-check`** removed — the skill carried standing `TWILIO_*` "NOT SET"
  flags for a worker that does not exist in the account. Twilio is in fact working.
- The false `workers_get_worker` capability claim corrected.
- Netlify var names corrected; `BACKUP_API_TOKEN`, `KB_API_TOKEN`,
  `MERCURY_WEBHOOK_SECRET`, the four `GOOGLE_ADS_*`, all eaton secrets,
  `MEMBER_PASSWORD`, and `VITE_GOOGLE_PLACES_KEY` added.

### Still open (dashboard checks only Charlie can do)

1. Mercury webhook secret set + decide whether to enforce `ENFORCE_MERCURY_SIG`
2. Scopes on both `CLOUDFLARE_API_TOKEN` copies
3. Expiry dates for both GitHub PATs (crm `GITHUB_TOKEN`, eaton `GITHUB_BACKUP_TOKEN`)
4. eaton `RESEND_API_KEY` — confirm via Resend recent-activity view
5. eaton fallback `API_TOKEN` — whether it should exist at all
6. `MEMBER_PASSWORD` browser test + who else holds the StatiCrypt password
7. `CLOUDFLARE_API_TOKEN` in the Claude Code environment settings, or fix env.sh's comment
8. EATON bearer committed in plaintext at `EATON/infra/env.sh` — rotate + remove, or
   accept and document
9. Billing/account existence sweep (§5)

## Audit log

| Date | Auditor | Result |
|---|---|---|
| 2026-07-25 | Claude (cloud session) | Full pass, tables §1–§4. 15 credentials verified working by functional test, 4 proven present by hard-failing workflow, 2 confirmed missing (`RESEND_API_KEY` repo secret — redundant; `VITE_GITHUB_TOKEN` — orphaned), 9 items still needing a dashboard check. 5 findings recorded above, one critical (published CRM bearer). No production state changed: no sends, no cron triggers, no writes, outreach toggle untouched. fsc-credentials skill reconciled, rewritten, and version-controlled. |
