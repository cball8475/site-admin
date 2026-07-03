# florence-dashboard-proxy (Cloudflare Worker)

Serves `dashboard.florencescservices.com` — the site-admin dashboard — behind
Cloudflare Access (org `florencesc.cloudflareaccess.com`, One-time PIN to
charlie@florencescservices.com):

- `/api/*` → `florence-crm-api` via **service binding**, with the
  `CRM_API_TOKEN` secret attached as the bearer (the token never reaches the
  browser).
- everything else → `florence-dashboard.pages.dev` (the built frontend from
  this repo's root).

## Source of truth

This directory is the canonical, version-controlled source. It was seeded from
the live deployed Worker on 2026-07-03 and hardened: `/api` previously used a
public `fetch()` to `api.florencescservices.com`, which is a same-zone
worker→worker fetch — Cloudflare blocks those (error 1042) unless the target
hostname is a Workers Custom Domain. The service binding sidesteps that
entirely (same pattern as `fsc-api-canary`).

## Deploy

Auto-deploys from `main` via `.github/workflows/deploy-worker.yml`
(`deploy-dashboard-proxy` job). Secrets persist across deploys.

## Secrets

- `CRM_API_TOKEN` — must equal the CRM worker's `API_TOKEN`. **Rotate both
  together**: if only the API side rotates, every dashboard data call 401s
  ("CRM API error" toast) while `/health` and the canary stay green. The
  deploy workflow can sync it from an optional `CRM_API_TOKEN` repo Actions
  secret.

## Hostname binding

`dashboard.florencescservices.com` is attached in the Cloudflare dashboard and
deliberately not declared in `wrangler.toml`, so deploys never touch it.
