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

Memory lives in the `florence-crm` D1 database
(`database_id 50e1fc12-682d-4d58-8506-93687a10dc36`). A fresh Claude session
starts blank, so it only works if each session writes to it.

- **Start of session:** read recent `dev_session_log` rows and the `knowledge`
  table to recover context.
- **End of any session that changed something, you MUST write:**
  1. `dev_session_log` — one row: `(session_date, title, summary, repos, prs, deploys)`.
  2. `knowledge` — durable facts/decisions/gotchas: `(category, area, subject, detail, tags, source_label)`.
  3. `achievements` — real milestones: `(date, category, title, description)`.

This lapsed before (`dev_session_log` stopped 2026-06-13; `knowledge` was empty
until 2026-06-18). Don't let it lapse again.

## SEO data is in this DB too

The Worker cron `handleSeoSnapshot` (06:00 UTC) writes daily Search Console data:
`seo_fix_snapshots` (position/impressions/clicks per query), `seo_fixes`
(monitored queries + baselines + intended fix), `data_store` key `gsc_top_queries`.
Verify SEO claims against this data — do not guess.
