# site-admin — Florence SC Services

The admin dashboard + every Cloudflare Worker behind
[florencescservices.com](https://florencescservices.com)'s two-sided local
lead marketplace. **Start with [SYSTEM.md](SYSTEM.md)** — architecture, the
daily automation flow, runbook, and the outreach sequence copy.
[SMOKE-TEST.md](SMOKE-TEST.md) is the verification evidence from the 2026-07
rebuild.

## Layout

| Path | What |
|---|---|
| `src/` | React/Vite admin dashboard → Cloudflare Pages (`florence-dashboard`), served at dashboard.florencescservices.com behind Cloudflare Access |
| `worker/florence-crm-api/` | The hub: prospects, leads, webhooks (CallRail/Twilio/Mercury), outreach log/suppression/toggle — `api.florencescservices.com` |
| `worker/florence-auto-outreach-emails/` | The outreach engine: daily discovery → filter → email-find → add → enroll → send → digest; holds the Resend key + `Mailer` RPC |
| `worker/florence-lead-followup/` | Mon–Fri operator nudges on unworked leads (24/72/120 h) |
| `worker/florence-outreach/` | Secured Claude proxy for dashboard copy-gen |
| `worker/florence-dashboard-proxy/` | Access-gated front door: static from Pages + token-injecting `/api` `/engine` `/outreach` proxies |
| `worker/d1-backup/`, `worker/kb-search/` | Nightly D1 backups; knowledge-base search |
| `kb/` | Durable memory (see `kb/fsc-memory.md`) |
| `data/` | Legacy pre-D1 outreach artifacts (read-only history) |

## Deploys

Push to `main` — each worker has a path-filtered workflow in
`.github/workflows/` (`cloudflare/wrangler-action`, repo secret
`CLOUDFLARE_API_TOKEN`); the dashboard publishes via `deploy-dashboard.yml`.
Secrets live in Cloudflare (names in each `wrangler.toml`), never in this
public repo.

## Dashboard dev

```sh
npm install && npm run dev
# direct-API dev needs: VITE_CRM_API_URL, VITE_CRM_API_TOKEN,
# VITE_ENGINE_URL, VITE_OUTREACH_URL (prod uses same-origin proxy paths)
```
