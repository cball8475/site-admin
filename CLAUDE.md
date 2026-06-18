# site-admin — CLAUDE.md

This is the admin/CRM app + Cloudflare Worker (`florence-crm-api`) behind the
Florence SC Services lead business. The website lives in `cball8475/cball8475.github.io`.

## Rule #0 — serve the revenue

This app exists to capture and manage **paying dumpster/junk leads** and to keep
the website's lead engine measurable. Guard the lead pipeline above all:

- The Worker must keep receiving/forwarding leads + SMS consent (`florence-crm-api`).
- Don't break Google Ads conversion tracking, Twilio, or the D1 lead tables.
- See the website repo's `CLAUDE.md` for the ranked SEO/revenue priorities.

## Persistent memory — update at the END of every session (do not skip)

**Canonical memory lives in git markdown in `site-admin/memory/`** — it is cloned
into every session at startup, so it is reliable even when MCP servers are down:

- `memory/KNOWLEDGE.md` — durable facts, decisions, gotchas.
- `memory/SESSIONS.md` — append-only session log (newest first).
- `memory/ACHIEVEMENTS.md` — real milestones.

These **mirror** the `florence-crm` D1 tables `knowledge` / `dev_session_log` /
`achievements` (`database_id 50e1fc12-682d-4d58-8506-93687a10dc36`), which the
dashboard app reads and the SEO cron writes. Keep both in sync.

- **Start of session:** read `memory/SESSIONS.md` and `memory/KNOWLEDGE.md` to
  recover context (fall back to the D1 tables if needed).
- **End of any session that changed something, you MUST:**
  1. Append a session entry to `memory/SESSIONS.md` **and** insert the same row
     into D1 `dev_session_log`.
  2. Add durable facts to `memory/KNOWLEDGE.md` **and** the D1 `knowledge` table.
  3. Log real milestones to `memory/ACHIEVEMENTS.md` **and** D1 `achievements`.

This lapsed before (`dev_session_log` stopped 2026-06-13; `knowledge` was empty
until 2026-06-18). Don't let it lapse again.

## SEO data is in this DB too

The Worker cron `handleSeoSnapshot` (06:00 UTC) writes daily Search Console data:
`seo_fix_snapshots` (position/impressions/clicks per query), `seo_fixes`
(monitored queries + baselines + intended fix), `data_store` key `gsc_top_queries`.
Verify SEO claims against this data — do not guess.
