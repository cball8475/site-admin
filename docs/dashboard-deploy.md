# fsc-dashboard — cutover runbook

Moves the site-admin dashboard off Netlify onto one Cloudflare Worker that serves
the SPA **and** proxies its CRM calls with the bearer attached server-side.

**Cloudflare Access is mandatory.** There is no bypass flag and no phased mode.
The worker refuses every request except `/__health` unless it carries a valid
Access JWT — verified by signature, issuer, and audience, not by header presence.
If the Access vars are unset, it refuses everything: unconfigured means locked,
not open.

Closes Finding 1 of the 2026-07-25 credential audit (the CRM bearer was published
in the public JS bundle).

---

## Part A — Cloudflare

### A1. CRM bearer in Secrets Store — already exists, nothing to create

Confirmed 2026-07-25: store `80c48360a0e54dd69425da2dfbde21ad` holds
`CRM_API_TOKEN` (comment "Shared FSC CRM…") alongside `EATON_TOKEN`, 2/100 used.
`wrangler.toml` already points at exactly that store and name, so the binding
resolves with no change. **Skip to A2.**

Two caveats, because the name existing does not mean the value is right:

- **Its vintage is unverified.** Secrets Store values can't be read back, so
  there is no way to confirm it matches florence-crm-api's `API_TOKEN` short of
  using it. This is now the *third* copy of the CRM bearer (worker secret,
  Netlify var, Secrets Store) and one of the other copies — the one cached in the
  fsc-credentials skill — had already gone stale without anyone noticing. Assume
  nothing.
- **"Shared" may mean something else already reads it.** If another worker binds
  `CRM_API_TOKEN`, rotating in C3 will affect it too. Check Secrets Store → the
  secret → its bindings before rotating, so a rotation doesn't break a caller
  nobody remembered.

**If tiles 401 after you log in, this is why** — the Secrets Store value doesn't
match the worker's `API_TOKEN`. That is not a broken proxy; a 503 would mean the
binding failed, a 401 means the bearer resolved but the CRM rejected it. Fix by
doing C3 now instead of later: set both to the same new value.

You can pre-empt it by doing C3 before B3 instead. The trade is that rotating
immediately breaks the Netlify dashboard (it carries the old baked token), which
costs you the rollback in C2. Fine if you're deleting Netlify anyway; otherwise
proceed in order and treat a 401 as the known, cheap failure.

### A2. Add Secrets Store (read) to the deploy token

Cloudflare → My Profile → API Tokens → edit the token used by site-admin CI.

It needs **Secrets Store (read)** on top of Workers Scripts (edit). This was
already on the audit's open list; it now blocks this deploy. Without it every
`/api` call returns 503.

### A3. Create the Access application

Zero Trust → Access → Applications → **Add an application** → Self-hosted.

- **Application name:** `FSC Dashboard`
- **Public hostname:** `dashboard.florencescservices.com`
- **Session duration:** 24 hours is a reasonable default
- **Policy:** Action `Allow` → Include → **Emails** → your address, plus anyone
  else who should get in
- **Identity provider:** Google works with the account already used for GA4;
  email OTP ("One-time PIN") needs no IdP setup

Free tier covers up to 50 users.

You can create the app before the hostname resolves — the worker deploy in B3
creates the DNS record.

### A4. Copy the two values the worker needs

Neither is a secret; both go in `wrangler.toml` in Part B.

- **AUD tag** — the Access application → Overview tab → *Application Audience
  (AUD) Tag*. A long hex string.
- **Team domain** — `https://<your-team-name>.cloudflareaccess.com`. The team
  name is in your Zero Trust dashboard URL, or under Settings → Custom Pages.

---

## Part B — Repo

### B1. Fill in the Access vars

Edit `wrangler.toml` and set both, using the values from A4:

```toml
ACCESS_TEAM_DOMAIN = "https://<your-team-name>.cloudflareaccess.com"
ACCESS_POLICY_AUD = "<the AUD tag>"
```

While either is empty the worker 403s everything. That's deliberate, but it also
means the deploy isn't finished until these are set.

### B2. Fix the build-time repo secrets

site-admin → Settings → Secrets and variables → Actions.

- **Add** `VITE_GOOGLE_PLACES_KEY`. The build needs it. It is a browser key —
  public by design; restrict it in C4.
- **Delete** `VITE_CRM_API_TOKEN` and `VITE_API_TOKEN` if either exists. The
  workflow hard-fails when it finds one, on purpose: Vite would inline it
  straight back into the public bundle.

`CLOUDFLARE_API_TOKEN` already exists and is verified working.

### B3. Merge to `main`

That triggers `.github/workflows/deploy-dashboard.yml`, which:

1. runs `npm run test:access` — the fail-closed regression test
2. refuses to build if a `VITE_*_TOKEN` is in the environment
3. builds `dist/` and refuses to publish if a credential shape appears in it
4. deploys, creating and proxying DNS for `dashboard.florencescservices.com`
5. **asserts the gate is closed** — that `/__health` reports both vars set and
   the Secrets Store binding resolving, that `/` and `/api/prospects` refuse
   unauthenticated requests, and that the `workers.dev` hostname does not answer

Step 5 fails the deploy rather than warning. On a first deploy it may report DNS
as unreachable; re-run once DNS answers.

---

## Part C — After it's live

### C1. Verify

- `https://dashboard.florencescservices.com` redirects to Access login, and after
  login every tile populates
- In a private window (no Access session): the same URL is refused
- `https://fsc-dashboard.cball8475.workers.dev` does not serve the app
- The JS bundle contains no `fsc_`-prefixed string
- `https://api.florencescservices.com/prospects` unauthenticated → 401

### C2. Delete the Netlify site — do not skip this

While `site-admin-fsc.netlify.app` answers it serves the **old bundle with the
embedded bearer**, and it sits outside Cloudflare's edge so Access cannot gate
it. Everything above is decorative until it's gone.

Netlify → site-admin-fsc → Site configuration → **delete the site**. At minimum,
unlink the repo and delete the `VITE_*` environment variables so no future build
can publish a token.

Keep it until C1 passes — it's the rollback.

### C3. Rotate the CRM bearer

The old value was publicly downloadable. Treat it as known.

Check the secret's bindings first (see A1) so you know what else is affected.

1. `npx wrangler secret put API_TOKEN --name florence-crm-api`
2. `npx wrangler secrets-store secret update 80c48360a0e54dd69425da2dfbde21ad`
   (secret `CRM_API_TOKEN`) — same value
3. Confirm tiles still populate, and the **old** token now returns 401

Doing this also resolves the A1 unknown: after it, the worker secret and the
Secrets Store copy provably match, because you set both.

No redeploy needed — the worker reads Secrets Store per request. And with Netlify
gone there's no third copy to drift out of sync, which is what let the
fsc-credentials registry go stale.

### C4. Restrict the Google Places key

It's inlined in the bundle by design, so the referrer restriction is its only
real protection. Google Cloud Console → Credentials → the Places key →
Application restrictions → HTTP referrers → `dashboard.florencescservices.com/*`,
and remove the Netlify domain.

### C5. Delete `florence-dashboard-proxy`

It 404s on every path and was an unfinished attempt at this same proxy. Workers &
Pages → florence-dashboard-proxy → Manage → Delete.

---

## Notes

**Rollback.** The Netlify site until C2 deletes it; after that, Workers & Pages →
fsc-dashboard → Deployments → roll back to the previous version.

**Don't toggle workers.dev in the dashboard.** `workers_dev = false` and
`preview_urls = false` live in `wrangler.toml`, and the next deploy overwrites any
dashboard-side change that disagrees with them.

**Local development.** Prod is pinned to same-origin `/api` with no token, so the
client can't be misconfigured into leaking again. Dev talks to the API directly:

```
# .env  (gitignored)
VITE_CRM_API_URL=https://api.florencescservices.com
VITE_CRM_API_TOKEN=<current bearer>
VITE_GOOGLE_PLACES_KEY=<places key>
```

`npm run dev` picks these up; `import.meta.env.PROD` is false there, so the dev
branch of each config line applies. `npm run test:access` needs no credentials.
