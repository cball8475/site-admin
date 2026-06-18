# Knowledge — durable facts, decisions, gotchas

Canonical, append-only knowledge base for the Florence SC Services lead
business. Mirrors the `knowledge` table in the `florence-crm` D1
(`database_id 50e1fc12-682d-4d58-8506-93687a10dc36`). When you learn something
durable, add it **here** and to the D1 table so both stay in sync.

Format per entry: **Subject** — detail. `[category/area]` `(source)`

---

## SEO

- **Primary money keyword** — `dumpster rental florence sc` is the #1 revenue
  keyword, owned by the pillar page `/dumpster-rental-florence-sc.html` (the
  highest-impression commercial query). Target: page 1 (position < 10), then
  hold. No other page — especially the homepage `/` — may target this exact
  phrase in its `<title>`, `<h1>`, or internal-link anchor text. `[SEO/website]`

- **Cannibalization incident (Jun 2026)** — the 6/9 commit retargeted the
  homepage H1 to the exact-match "Dumpster Rental in Florence, SC", cannibalizing
  the pillar page; `dumpster rental florence sc` slid 9.5 → ~19 (page 1 → page 2).
  The 6/12 de-dupe fix is live (homepage H1 no longer exact-match; pillar owns
  it); recovering. **Lesson: one page per exact term; the homepage must never
  compete with a pillar page.** `[SEO/website]`

- **Ranking data source of truth** — the `florence-crm` D1 holds the real GSC
  data, refreshed daily by the worker cron `handleSeoSnapshot` (06:00 UTC):
  `seo_fix_snapshots` (daily position/impressions/clicks per tracked query),
  `seo_fixes` (monitored queries + `baseline_pos` + `suggested_fix`),
  `data_store` key `gsc_top_queries` (latest top-query window). Verify SEO claims
  against this — do not guess. `[SEO/data]`

## Process

- **Revenue-first guardrail** — `cball8475.github.io/CLAUDE.md` is binding.
  Rule #0: the site exists to make money. It ranks protected assets by revenue
  value and gives a pre-change checklist. Check **every** change against it
  before commit. `[process/website]`

- **Memory-update protocol** — after every session, update memory in **two
  places that mirror each other**: (1) these markdown files in `site-admin/memory/`
  (canonical, git-versioned, cloned into every session), and (2) the `florence-crm`
  D1 tables `knowledge` / `dev_session_log` / `achievements` (queryable, read by
  the dashboard app). Read memory at session start; write it at session end.
  This protocol lapsed once — `dev_session_log` stopped 2026-06-13 and `knowledge`
  was empty until 2026-06-18. Don't let it lapse again. `[process/memory]`
