# Florence SC Services — site-admin

Admin dashboard (React + Vite) plus the Cloudflare Workers behind the FSC
business: CRM API, email reply ingest, KB search, and D1 backup.

**This repository is public.** No credential, token, or key goes in a tracked
file, ever — not in code, not in docs, not in a commit message. Keys live in
Cloudflare secrets and GitHub Actions secrets. Deleting a leaked secret later
does not help; git history serves it forever, so a leak has to be rotated.

## Layout

- `src/` — the Vite dashboard (`App.jsx` plus components).
- `worker/` — four Workers, each with its own `wrangler.toml` and `src/index.js`:
  - `florence-crm-api` — the CRM API. D1 `florence-crm`, service binding to the
    shared `Mailer`. Daily cron.
  - `email-reply-ingest` — inbound email into D1. Request-driven, no cron.
  - `kb-search` — Vectorize-backed KB search over the EATON D1. Daily reindex cron.
  - `d1-backup` — nightly export of five D1 databases to R2. Daily cron.
- `.github/workflows/deploy-*.yml` — one deploy workflow per Worker. They run on
  GitHub's runners, which hold `CLOUDFLARE_API_TOKEN`.
- `kb/fsc-memory.md` — durable infrastructure knowledge. `docs/credential-audit.md`
  — where each credential lives, by name only.

## Source of truth

| Fact | Lives in |
|---|---|
| A Worker's bindings, crons, compatibility date | that Worker's `wrangler.toml` |
| What a Worker actually reads off `env` | that Worker's `src/index.js` |
| Which credential exists and where | `docs/credential-audit.md` — names only, never values |
| Durable infrastructure decisions | `kb/fsc-memory.md`, and the `memory` table in D1 |

Deploy through the Actions workflows. A `curl PUT` at the Cloudflare API also
works but wipes the Worker's secrets, which then have to be re-set.

## Cron rules, learned the hard way

- **Cloudflare cron day-of-week is Quartz-style: 1 is Sunday, 7 is Saturday.**
  Not POSIX. Spell days out (`MON`, `FRI`) and match the literal string in the
  `scheduled()` handler. A numeric day fires a day early — in EATON it put
  backups on Sundays and digests on Thursdays for weeks before anyone noticed.
- **Verify a cron by its outcome, never by its exit status.** A file in the
  bucket, a row in the table, an email in the inbox. `ctx.waitUntil(p)` inside a
  `try`/`catch` catches nothing, and a helper returning `{ok: false}` instead of
  throwing is a silent failure by construction.

## Agent Fleet

`.claude/agents/` holds read-only subagent definitions. The wide, independent
work here is per-Worker: four Workers, each with a toml, a source file and a
deploy workflow that have to agree, and no Worker's answer depends on another's.

This is a small fleet — four items, not fifty. It earns its place because the
checks are mechanical, easy to get wrong by hand, and the failure mode is
silent: a Worker with a broken binding or a cron that logs instead of throwing
looks healthy from outside.

### Doctrine

**Agents read, Charlie approves, the main session writes.** Every agent is
read-only: no edits, no commits, no `wrangler`, no deploys. That is what makes
fan-out safe — read-only agents cannot overwrite each other.

**One job per agent, scoped to one Worker.** Fan-out comes from spawning four,
not from handing one agent the directory listing.

**Every agent file restates the rules it depends on.** No agent inherits this
file. The read-only rule, the public-repo secret rule, the Quartz day-of-week
rule and the silent-failure patterns are written into each definition.

**Documented false positives live in the file.** The load-bearing one here:
`d1-backup` reads all five of its D1 bindings through `env[src.binding]`, so a
static `env.X` grep reports every one of them as unused. Five false positives
out of five.

**Structured output block at the end of every definition.**

**Findings go through `finding-verifier`** before Charlie sees them. It defaults
to `REFUTED`.

**No secret value appears in any agent output.** Agents name variables. They
never read or print values, and this repo being public is why.

### The agents

| Agent | Item | Reports |
|---|---|---|
| `worker-config-auditor` | one Worker | bindings vs code, crons vs handlers, numeric day-of-week, silent failure in `scheduled()` |
| `finding-verifier` | one finding | `CONFIRMED` / `REFUTED` / `UNVERIFIABLE` |

### When to fan out, when to single-thread

**Fan out** when the items are independent and nothing writes: auditing all four
Workers, verifying a set of findings.

**Single-thread** when steps depend on each other or when anything writes. Every
`wrangler.toml` change, every deploy, every secret rotation and every commit
stays sequential and stays in the main session. A deploy is not reversible by
the next agent.

### Watch the first minute

Read the opening of a run before stepping away — whether the agent read the toml
and the source together, and searched for `env[` before calling a binding dead.
Signals worth catching early: a binding reported unused without a dynamic-access
search, a secret named where a binding was meant, scope widening into a sibling
Worker.
