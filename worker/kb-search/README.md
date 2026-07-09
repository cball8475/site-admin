# kb-search

Semantic search over the **EATON knowledge base**. Ask in plain language
("what do I know about torque MSA requirements", "who owns the competency
matrix") and get the most relevant institutional-memory entries back — instead
of keyword-grepping D1.

## How it works

1. **Reindex** reads the free-text tables from `eaton-ehs-dashboard`, builds one
   text blob per row, embeds it with Workers AI (`bge-base-en-v1.5`, 768-dim),
   and upserts into the `eaton-kb` Vectorize index with metadata
   `{ source, table, row_id, title }`.
2. **Search** embeds the query, runs a cosine nearest-neighbour lookup, and
   hydrates each hit from D1 for a fresh snippet.

**Corpus** (edit `CORPUS` in `src/index.js`):
`knowledge`, `tribal_knowledge` (only rows not superseded), `people_intel`,
`leadership_moves`, `weekly_reflections`.

## Endpoints

Both require `Authorization: Bearer <API_TOKEN>` once the secret is set.

- `POST /reindex` — rebuild the index (also runs nightly via cron at 07:30 UTC).
- `GET /search?q=<question>&k=5` — top-k results with score, title, snippet.
- `GET /` — service info (open).

## One-time setup

1. **Create the Vectorize index** — run the **“Setup R2 bucket + Vectorize
   index”** GitHub Action, or locally:
   ```bash
   wrangler vectorize create eaton-kb --dimensions=768 --metric=cosine
   ```
   (Vectorize + Workers AI require the Workers **Paid** plan.)
2. **Deploy** — the *Deploy kb-search* Action runs on pushes to `main` touching
   `worker/kb-search/**`, or trigger it manually. Uses repo secret
   `CLOUDFLARE_API_TOKEN`.
3. **First index** — after deploy, `POST /reindex` once (or wait for the nightly
   cron) to populate the index.
4. **(Recommended)** set repo secret `KB_API_TOKEN` to lock the endpoints.

## Extending to Florence / FSC memory

Add a second D1 binding (e.g. `DB_CRM`) in `wrangler.toml`, append `CORPUS`
entries for `florence-crm`'s `knowledge` / `memory` tables tagged
`source: "florence"`, and filter by `source` at query time to keep work and
business context separate.

## Notes

- Embedding + upsert happens in batches of 96 rows to stay within Workers AI
  limits. Current corpus is small (hundreds of rows), so a full reindex is cheap.
- Re-running `/reindex` is idempotent — vector IDs are `"<table>:<row_id>"`.
