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
| RESEND_API_KEY (crm) | Indirect only: Resend dashboard → recent activity; a send-test is forbidden |
| TWILIO_SID/AUTH_TOKEN | Twilio console → message logs load (read-only); no test send |
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
| Secret | Purpose | Breaks without it |
|---|---|---|
| API_TOKEN | Bearer auth for the CRM API | Dashboard + all API callers |
| RESEND_API_KEY | Owner lead-alert emails | Lead alerts (off, logged) |
| GOOGLE_ADS_CLIENT_ID | Google OAuth (Ads + GSC) | Ads metrics, SEO snapshot cron |
| GOOGLE_ADS_CLIENT_SECRET | Google OAuth | Same |
| GOOGLE_ADS_REFRESH_TOKEN | Google OAuth | Same |
| GOOGLE_ADS_DEVELOPER_TOKEN | Google Ads API | Ads metrics |
| TWILIO_ACCOUNT_SID | SMS lead alerts | SMS alerts |
| TWILIO_AUTH_TOKEN | SMS lead alerts | SMS alerts |
| MERCURY_WEBHOOK_SECRET | Mercury webhook HMAC (note: ENFORCE_MERCURY_SIG is false in code — flag this during audit) | Webhook auth is advisory |

Plain vars (wrangler.toml / dashboard, not secrets): LEAD_ALERT_FROM,
LEAD_ALERT_TO, OPERATOR_PHONE. Bindings: DB (D1), MAILER (service binding —
verify target worker exists).

### d1-backup
| Secret | Purpose | Breaks without it |
|---|---|---|
| API_TOKEN | Locks /backup + /backups (fails closed since 2026-07-25; synced from GitHub secret BACKUP_API_TOKEN) | Manual endpoints 401 |

Vars: RETENTION_DAYS. Bindings: 5× D1 (DB_EATON, DB_CRM, DB_FAMILY, DB_BHE,
DB_TINY), R2 BACKUPS. Verify a backup object exists for today in R2.

### kb-search
| Secret | Purpose | Breaks without it |
|---|---|---|
| API_TOKEN | Locks /search + /reindex (fails closed; synced from GitHub secret KB_API_TOKEN) | Endpoints 401 |

Vars: EMBED_MODEL (optional). Bindings: DB (D1 eaton-ehs-dashboard), AI, VEC
(Vectorize eaton-kb).

### email-reply-ingest
No secrets. Var: FORWARD_TO (optional, defaults to cball8475@gmail.com).
Binding: DB (florence-crm D1). Verify Email Routing rule points at this worker.

### eaton-ehs-api
| Secret | Purpose | Breaks without it |
|---|---|---|
| API_TOKEN | Fallback bearer auth (Secrets Store is primary) | Auth falls to Secrets Store only |
| AUTH_TOKEN (Secrets Store binding → EATON_TOKEN, store 80c48360…) | Primary bearer auth | All API callers |
| ANTHROPIC_API_KEY | /otter/extract transcript extraction | Debrief extraction 502s |
| RESEND_API_KEY | Friday weekly digest email | Digest cron fails (loudly, since v3.9.3) |
| GITHUB_BACKUP_TOKEN | Monday D1 backup push to GitHub (PAT, repo scope — check expiry) | Backup cron fails (loudly) |

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

| Repo | Secret | Purpose |
|---|---|---|
| site-admin | CLOUDFLARE_API_TOKEN | Deploys all 4 workers |
| site-admin | BACKUP_API_TOKEN | Synced to d1-backup as API_TOKEN; deploy FAILS if missing |
| site-admin | KB_API_TOKEN | Synced to kb-search as API_TOKEN; deploy FAILS if missing |
| site-admin | RESEND_API_KEY | Synced to florence-crm-api (warning if missing) |
| EATON | CLOUDFLARE_API_TOKEN | Deploys eaton-ehs-api (added 2026-07-25) |
| LWVNewportCounty | MEMBER_PASSWORD | StatiCrypt member portal; build FAILS if missing |

Token scope check for both CLOUDFLARE_API_TOKEN copies: Workers Scripts (edit),
D1 (edit), R2 (edit), Vectorize (edit), Workers AI, Secrets Store (read).

---

## 3. Netlify environment variables (site-admin dashboard)

Netlify → site-admin → Site configuration → Environment variables. Build-time
(VITE_ prefix) — changing them requires a redeploy.

| Variable | Purpose |
|---|---|
| VITE_CRM_API_URL | CRM API base URL |
| VITE_API_TOKEN | CRM bearer (must equal florence-crm-api API_TOKEN) |
| VITE_GITHUB_TOKEN | GitHub PAT for dashboard features (check expiry) |

---

## 4. Claude-side (fsc-credentials skill + session env)

| Item | Check |
|---|---|
| CLOUDFLARE_API_TOKEN in Claude Code env settings | env.sh claims every session exports it — the 2026-07-25 cloud session did NOT have it. Verify claude.ai/code → environment settings, or correct env.sh's comment |
| fsc-credentials registry (references/registry.md) | Reconcile against this whole file; add BACKUP_API_TOKEN + KB_API_TOKEN entries (created 2026-07-25, values in GitHub secrets) |
| Rotation SOP dates | Any credential with no known rotation date gets one scheduled |

---

## 5. Third-party accounts referenced by the stack (existence + billing check)

Anthropic (API key above) · Resend (domain verified: florencescservices.com) ·
Google Cloud OAuth app (Ads/GSC scopes) · Twilio · Mercury (webhook) ·
GitHub PATs (×2: dashboard + EATON backup — both have expiry dates, record them)
· Netlify · Cloudflare (Workers paid features: D1, R2, Vectorize, AI, Secrets
Store) · StatiCrypt password (member-facing — who else holds it?).

---

## Audit log

| Date | Auditor | Result |
|---|---|---|
| _(fill during audit session)_ | | |
