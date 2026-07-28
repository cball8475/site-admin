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

### A2. Deploy token needs Secrets Store (read) — the one open item

Token inventory and scope findings: see the private registry
(`cball8475/skills` → `skills/personal/fsc-credentials/references/`).

Whether the repo's `CLOUDFLARE_API_TOKEN` is either of these could not be
determined: an account-owned token cannot enumerate user-owned tokens, so a third
user-owned token may be the one CI uses.

**Decisive test:** deploy and read `/__health`. `crm_binding_present: false` (or a
binding error at deploy) means the scope is missing. `503` on `/api/*` at runtime
means the same thing.

**Recommended instead of editing an existing token:** create one new
least-privilege token — Workers Scripts (edit), Secrets Store (read), D1 (edit),
R2 (edit), Vectorize (edit), Workers AI — put it in the site-admin repo secret,
then delete both "CF Master Token"s. That resolves A2, retires a never-used
credential, and replaces a master-scoped token in CI with a scoped one, in a
single pass. A token literally named "master" is more authority than a dashboard
deploy needs.

### A3. Access application — already exists, nothing to create

Verified 2026-07-25. Zero Trust org `florencesc.cloudflareaccess.com`:

- **FSC Dashboard** — self-hosted, `dashboard.florencescservices.com`, 24h
  session, id `f584791f-cc99-45f0-90f1-e750c2c5cb43`
- One policy: **"Charlie only"** → allow → include email
  `charlie@florencescservices.com`
- Account IdPs: **One-time PIN only** (no Google/SAML/OIDC configured)

Two other Access apps exist on the account: `eaton-ehs-cmd.pages.dev` and
`*-florence-crm-api.cball8475.workers.dev`.

#### ⚠️ Verify you can actually receive the login code

One-time PIN is the only identity provider, so signing in means reading a code
emailed to `charlie@florencescservices.com` — the single address the policy
allows. That address's deliverability is doubtful:

- Email Routing on `florencescservices.com` delivers to the
  **email-reply-ingest worker**, which logs arrivals to D1 rather than to a
  mailbox — 104 `inbound_nonprospect` rows, most recent 2026-07-25 16:24.

If the code never arrives you cannot reach the dashboard. Not a hard lockout —
you can edit the policy any time — but verify before assuming the cutover
succeeded. Any of these fixes it:

1. Add a second `include` email you definitely read (e.g. your Gmail). Fastest.
2. Add an Email Routing rule so `charlie@florencescservices.com` forwards to a
   real inbox ahead of the catch-all that feeds the ingest worker.
3. Configure Google as an IdP — the GA4 account already exists — and switch the
   policy to that.

### A4. The two worker values — already filled in

Read from the live account and committed to `wrangler.toml`; nothing to copy:

```toml
ACCESS_TEAM_DOMAIN = "https://florencesc.cloudflareaccess.com"
ACCESS_POLICY_AUD = "8e44f1070780a22a9b34ffe5b4a087875b8de28eae1581ecefa4a503c87eaaee"
```

Neither is a secret — the AUD is an audience identifier that travels in the JWT.

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

- **`VITE_GOOGLE_PLACES_KEY` — do NOT add it.** The build does not need it, and
  setting it publishes the key in the bundle. `App.jsx:869` falls back to
  `localStorage`, and with the var unset the prospect-discovery UI renders a
  "Paste Google API key…" field that persists per browser (the same pattern the
  EATON dashboard uses for its bearer). Behind Access you are the only one who
  reaches that UI. Paste it once and the key is never published.

  If you ever do want it baked in, the current value is copyable from Netlify →
  Site configuration → Environment variables, or from Google Cloud Console →
  APIs & Services → Credentials.
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

While the old Netlify origin answers it serves a superseded build and sits
outside Cloudflare's edge, so Access cannot gate it. Everything above is
decorative until it's gone.

Netlify → site-admin-fsc → Site configuration → **delete the site**. At minimum,
unlink the repo and delete the `VITE_*` environment variables so no future build
can publish a token.

Keep it until C1 passes — it's the rollback.

### C3. Rotate the CRM bearer

The old value was publicly downloadable. Treat it as known.

#### "Rotate here once" does not hold yet — read this first

The Secrets Store comment says *"Shared FSC CRM bearer; guards florence-crm-api
inbound + used by dashboard-proxy/lead-capture/outreach to call CRM. Rotate here
once."* That is the right design, but the code doesn't implement it yet. Verified
against deployed source 2026-07-25:

| Worker | How it gets the bearer | Rotating Secrets Store reaches it? |
|---|---|---|
| florence-crm-api | `env.API_TOKEN` — plain worker secret, validates inbound. Zero Secrets Store usage in source or config | ❌ no |
| florence-dashboard-proxy | `` `Bearer ${env.CRM_API_TOKEN}` `` — plain string interpolation, so a plain worker secret | ❌ no |
| florence-lead-capture | same plain interpolation when POSTing to `/leads` | ❌ no |
| florence-outreach | not yet verified — check before rotating | ❓ |
| fsc-dashboard (new) | `await env.CRM_API_TOKEN.get()` — real Secrets Store binding | ✅ yes |

A Secrets Store binding is an **object** requiring `await .get()`. Interpolating
one into a template string yields `[object Object]`, so those two workers cannot
be reading the Secrets Store copy — they hold their own duplicates.

**So a rotation today is 5–6 places, not one:** florence-crm-api `API_TOKEN`,
dashboard-proxy, lead-capture, outreach, Secrets Store, and Netlify until C2
deletes it. Miss any and that caller 401s.

**To make the comment true,** migrate each consumer to the Secrets Store binding —
including florence-crm-api's inbound guard, which should read its expected token
from Secrets Store the way eaton-ehs-api already reads `AUTH_TOKEN`
(`env.AUTH_TOKEN.get()` with a fallback). After that, rotation genuinely is one
`secrets-store secret update`. Worth doing before the next rotation rather than
after.

#### The rotation itself

1. `npx wrangler secret put API_TOKEN --name florence-crm-api`
2. `npx wrangler secrets-store secret update 80c48360a0e54dd69425da2dfbde21ad`
   (secret `CRM_API_TOKEN`) — same value
3. Same value into dashboard-proxy, lead-capture, and outreach (or delete
   dashboard-proxy first per C5, which removes one)
4. Confirm tiles populate, lead capture still posts, and the **old** token now
   returns 401

Note the Secrets Store copy was last modified **2026-07-03**, which is the only
signal available on its vintage — values are not readable. Doing this rotation
resolves the A1 unknown outright, because you set both sides yourself.

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
