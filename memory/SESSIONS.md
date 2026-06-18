# Session log — newest first

Append-only narrative of every working session. Canonical copy; mirrors the
`dev_session_log` table in the `florence-crm` D1
(`database_id 50e1fc12-682d-4d58-8506-93687a10dc36`). Add a new entry at the top
at the END of every session that changed something, and insert the same row in
D1 so both stay in sync.

Format:
```
## YYYY-MM-DD — Title
- **Summary:** what changed and why
- **Repos:** ...
- **PRs:** ...
- **Deploys:** ...
```

---

## 2026-06-18 — SEO position-decline diagnosis + revenue-first guardrail + memory setup
- **Summary:** Diagnosed the average-position decline from the `florence-crm` D1
  (`seo_fix_snapshots` / `seo_fixes`), not guesses. It is real and concentrated
  in the #1 money keyword `dumpster rental florence sc`: slid 9.5 (6/6) → ~19.4
  (6/18), off page 1. Root cause (recorded in `seo_fixes`): the 6/9 homepage H1
  retarget to the exact-match phrase cannibalized the pillar page. The 6/12
  de-dupe is live; trend flattened/began recovering 6/15–6/18. Fixed one residual
  cannibalization signal (`florence-sc-landfill-guide.html` "Related Reading" link
  pointed to the homepage → repointed to the pillar). Added 6 missing indexable
  pages to `sitemap.xml`. Added `CLAUDE.md` (revenue-first priorities + pre-change
  checklist) to both repos. Established this markdown memory layer + memory-update
  protocol; seeded `knowledge` (was empty) and resumed `dev_session_log` (had
  lapsed since 6/13).
- **Repos:** cball8475/cball8475.github.io, cball8475/site-admin
- **PRs:** none (work on branch `claude/seo-page-position-decline-ci62h7`)
- **Deploys:** none — pushed to feature branch, not merged to main

## 2026-06-13 — Mercury webhook + SEO documentation + legal docs
- **Summary:** Added `florence-crm-api` `/webhook/mercury` endpoint (HMAC-SHA256
  signature verification; returns 200 for Mercury verification where the dashboard
  root had returned 302).
- **Repos:** cball8475/site-admin
- **PRs:** site-admin#3 (mercury endpoint), site-admin#4 (signature verification) — merged
- **Deploys:** florence-crm-api auto-deployed via wrangler-action (runs #3, #4)

## 2026-06-12 — A2P Customer Care reframe + SEO audit (website)
- **Summary:** Reframed the site from lead-gen to Customer Care (Model A);
  partners.html → crew network; Google Ads conversion tracking on city forms;
  landfill CTR title/meta.
- **Repos:** cball8475/cball8475.github.io

## 2026-06-09 — Homepage SEO + GSC 404 fix
- **Summary:** Homepage H1 → Florence SC, service-area strip, pricing direct
  answer, residential FAQ + schema; fixed GSC 404 from relative landfill links.
  (NOTE: this H1 change later proved to be the cannibalization cause — see
  KNOWLEDGE.md.)
- **Repos:** cball8475/cball8475.github.io

## 2026-06-07 — Local reviews + dropped-query links
- **Summary:** Added local reviews and fixed internal links for dropped Page-1 queries.
- **Repos:** cball8475/cball8475.github.io

## 2026-06-06 — SEO cannibalization + cost FAQs
- **Summary:** Near-me / 30–40yd / commercial fixes, closed internal-link
  cannibalization gaps, cost FAQs on 4 city pages, landfill cross-links.
- **Repos:** cball8475/cball8475.github.io

_Older sessions (ids ≤ 22) remain in the D1 `dev_session_log` table._
