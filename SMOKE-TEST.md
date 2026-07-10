# Smoke test — outreach rebuild, 2026-07-10

One page of evidence that every acceptance criterion works, so nothing has to
be taken on faith. Everything below is reproducible from the runbook in
[SYSTEM.md](SYSTEM.md).

## Preflight (environment)

| Check | Result |
|---|---|
| Cloudflare token valid (`wrangler whoami`) | ✅ `Cball8475@gmail.com's Account` (37821191…) |
| D1 reachable (`wrangler d1 execute florence-crm --remote "SELECT 1"`) | ✅ |
| Hub reachable (`GET https://api.florencescservices.com/`) | ✅ (401 = alive + auth enforced; `/health` → `{"status":"ok","version":"2.25.0"}`) |
| Google Places key server-side | ✅ text search returned Florence operators from a Worker/server context (not referrer-locked) — and live discovery ran (below) |
| `RESEND_API_KEY` works | ✅ two production sends, both 2xx (below) |
| `CRM_API_TOKEN` valid | ✅ engine `/preflight` → `"crm_api":"ok"` (delegated `/auth/check`), and the engine created prospects through the authed CRM API |
| Repo + CI | ✅ site-admin consolidated; deploys ran green on GitHub Actions (runs 9–11 of “Deploy florence-crm-api”, branch `claude/new-session-1nif9k`) |

## Resend proof (a message is only “sent” on 2xx)

- **Test email** to charlie@florencescservices.com — Resend id
  `6aa7726c-c2bc-4c81-a8cd-04a7a880862b`, status 200 (CI asserted the 2xx;
  `outreach_log` row 1). Footer shows the CAN-SPAM address + one-click
  unsubscribe exactly as prospects will see it.
- **Daily digest** — Resend id `b548996a-7650-4048-a32a-80c4276d6a6c`,
  status 200 (`outreach_log` row 53). Subject carries `[paused]`.
- Failure path: a non-2xx leaves sequence state untouched (`email_failed`
  logged, step retries next run) — see `runSend()`; `outreach_state` gets
  `status='failed'` instead of `sent`.

## Live dry-run of the whole pipeline (run `r_20260710_4sq0`)

Engine v2.1.0, **kill switch paused** (its default). From `outreach_log`:

- **Discovered 15** candidates (6 Places queries, 2 verticals), 1 already
  known, **9 auto-rejected — every one with a logged reason**:
  - `not_relevant_to_vertical` ×6 — maid/janitorial services, a laundromat,
    a pressure-washing outfit (adjacent-category drift from Places)
  - `disposal_facility_or_government` — the county recycling center
  - `national_chain_or_franchise` — a SERVPRO franchise (a College Hunks
    franchise was caught the same way in the first run)
  - full names + reasons: `outreach_log` rows 31–39 (private D1)
- **5 processed** → email scrape (homepage + contact, no paid APIs).
  Specific companies/addresses live in the private D1 `outreach_log`
  (rows 41–50) and the CRM — kept out of this public doc on purpose:
  - two hauling operators → **email found by scraping** (one role `info@`
    address, one owner address) → **enrolled** (`hauling_new_prospect`,
    zone 4 was open)
  - one hauling operator → email found, but **its zone already has an active
    operator → `added_not_enrolled: zone_occupied`** (exclusivity enforced)
  - two dumpster operators → no email discoverable after scraping → added,
    not enrolled (`no_email`), phone kept for manual outreach
- **Sends skipped** (paused/dry) with the would-send list captured — **zero
  cold emails have been sent to anyone**.
- **Digest sent** (Resend 200) → `run_finished`.

Charlie's inbox after the smoke: 1 test email + 1 digest. Nothing else.

## Security checks

| Check | Result |
|---|---|
| `florence-outreach` unauthenticated POST | ✅ **401** (CI-asserted on every deploy). v1 was a fully open Anthropic proxy. |
| Valid-token path | dashboard → `/outreach/*` via dashboard-proxy (token injected server-side); CRM-token curl works per its README |
| Dashboard hostname | ✅ anonymous → 302 to `florencesc.cloudflareaccess.com` (Cloudflare Access) for `/`, `/api/*`, `/engine/*` |
| dashboard-proxy workers.dev | ✅ disabled in wrangler.toml (would bypass Access) |
| Secrets in git | ✅ none — names only in wrangler.toml comments; repo is public |

## State as handed over

- Engine **paused** (`outreach_toggle`: “default safe state — never
  unpaused”). Un-pausing is the go-live act and it's Charlie's.
- 2 prospects sit enrolled at step 0 (named in the digest email and
  `outreach_log`), so the first un-paused weekday run sends exactly those
  two intro emails.
- `suppression` empty; `outreach_log` has the full history above
  (`GET /outreach-log`, or dashboard → Outreach Engine → 🤖 Automation).

## Re-run this smoke anytime

```sh
curl https://florence-auto-outreach-emails.cball8475.workers.dev/preflight   # all-green booleans
curl -X POST -H "Authorization: Bearer $TOKEN" ".../trigger?dry=1"           # full dry run
curl -H "Authorization: Bearer $TOKEN" ".../outreach-log?day=$(date +%F)"    # watch it happen
# or: Actions → “Deploy florence-crm-api” → Run workflow (bootstrap_all + dry_run)
```
