# fsc-dashboard — cutover runbook

Moves the site-admin dashboard off Netlify onto a single Cloudflare Worker that
serves the SPA **and** proxies its CRM calls with the bearer attached
server-side. Closes Finding 1 of the 2026-07-25 credential audit (the CRM bearer
was published in the public JS bundle).

**Do the steps in order.** Step 7 is the one that actually closes the hole — the
old Netlify site keeps serving a bundle with an embedded bearer and bypasses
Cloudflare Access until it is gone.

What's already in the repo: the worker (`worker/dashboard/src/index.js`), its
config (`wrangler.toml`), the deploy workflow
(`.github/workflows/deploy-dashboard.yml`), and the client changes that pin prod
to same-origin `/api` with no credentials.

---

## 1. Create the CRM bearer in Secrets Store

Same store that already holds `EATON_TOKEN`, so no new mechanism.

```bash
npx wrangler secrets-store secret create 80c48360a0e54dd69425da2dfbde21ad \
  --name CRM_API_TOKEN --scopes workers --remote
```

It prompts for the value — paste the **current** florence-crm-api `API_TOKEN`.
Don't rotate yet; get the new path working against the known-good value first,
then rotate in step 8. (Dashboard alternative: Cloudflare → Secrets Store →
select the store → Add secret, name `CRM_API_TOKEN`, scope Workers.)

## 2. Confirm the deploy token can read it

`CLOUDFLARE_API_TOKEN` in the site-admin repo needs **Secrets Store (read)** on
top of Workers Scripts (edit). This was already on the audit's open list. Without
it the deploy succeeds but every `/api` call returns 503.

Cloudflare → My Profile → API Tokens → edit the token → add the permission.

## 3. Fix the build-time repo secrets

- **Add** `VITE_GOOGLE_PLACES_KEY` (site-admin → Settings → Secrets and
  variables → Actions). The build needs it, and it's a browser key — public by
  design, but see step 9.
- **Delete** `VITE_CRM_API_TOKEN` / `VITE_API_TOKEN` if either exists as a repo
  secret. The workflow hard-fails when it finds one, on purpose: Vite would
  inline it straight back into the public bundle.

## 4. Deploy

Merge this branch to `main`. The workflow builds `dist/`, scans it for
credential shapes, then deploys. Cloudflare creates and proxies the DNS record
for `dashboard.florencescservices.com` automatically from the `[[routes]]`
custom-domain entry — no manual DNS.

First deploy may take a minute for DNS to answer; the workflow's smoke test
warns rather than fails on that.

## 5. Verify before locking it down

- `https://dashboard.florencescservices.com` loads and every tile populates
- `https://dashboard.florencescservices.com/api/health` → 200
- View source / open the JS bundle and confirm **no** `fsc_`-prefixed string
- Direct CRM access still fails unauthenticated:
  `curl -s -o /dev/null -w '%{http_code}' https://api.florencescservices.com/prospects` → 401

## 6. Put Cloudflare Access in front

Zero Trust → Access → Applications → Add a self-hosted application.

- Domain: `dashboard.florencescservices.com`
- Policy: Allow → Emails → your address (and anyone else who needs it)
- Identity: Google works with the account already used for GA4, or email OTP

Free tier covers up to 50 users.

Then flip the belt-and-braces check in `wrangler.toml`:

```toml
REQUIRE_ACCESS = "true"
```

and push. The worker then refuses any `/api` request that didn't arrive through
Access. Note this is a **presence** check on `Cf-Access-Jwt-Assertion`, not
signature verification — it's meaningful because the hostname is only reachable
through Access, and it's defense in depth, not the primary gate. If you want the
stronger version later, verify the JWT against
`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.

## 7. Tear down Netlify — this is the step that closes the hole

Until this is done, `site-admin-fsc.netlify.app` still answers, still serves a
bundle with the old embedded bearer, and is not behind Access. Everything above
is decorative while it's up.

Netlify → site-admin-fsc → Site configuration → **delete the site** (or at
minimum unlink the repo and delete the `VITE_*` environment variables so no
future build can publish a token).

## 8. Rotate the CRM bearer

The old value is burned — it was publicly downloadable, so treat it as known.

1. `npx wrangler secret put API_TOKEN --name florence-crm-api` → paste the new value
2. `npx wrangler secrets-store secret update 80c48360a0e54dd69425da2dfbde21ad` → same value
3. Confirm: dashboard tiles still populate; direct API call with the **old**
   token → 401

From here rotation is a two-place change with no rebuild, and after step 7 there
is no third copy in a Netlify env var to drift out of sync — which is what made
the fsc-credentials registry go stale in the first place.

## 9. Restrict the Google Places key

It's inlined in the bundle by design (browser key), so its only real protection
is the referrer restriction. Google Cloud Console → Credentials → the Places key
→ Application restrictions → HTTP referrers → set
`dashboard.florencescservices.com/*` and remove the Netlify domain.

## 10. Retire the dead proxy

`florence-dashboard-proxy` 404s on every path and appears to be an earlier,
unfinished attempt at exactly this. Delete it so there's one proxy, not two:
Workers & Pages → florence-dashboard-proxy → Manage → Delete.

---

## Rollback

The Netlify site is the rollback until step 7 deletes it — so don't do step 7
until step 5 has passed. After that, rollback is redeploying the previous
Worker version (Workers & Pages → fsc-dashboard → Deployments → roll back).

## Local development

Prod is pinned to same-origin `/api` with no token, so the client can't be
misconfigured into leaking again. Dev still talks to the API directly:

```
# .env  (gitignored)
VITE_CRM_API_URL=https://api.florencescservices.com
VITE_CRM_API_TOKEN=<current bearer>
VITE_GOOGLE_PLACES_KEY=<places key>
```

`npm run dev` picks these up. `import.meta.env.PROD` is false there, so the dev
branch of each config line applies.
