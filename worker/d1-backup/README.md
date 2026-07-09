# d1-backup

Nightly SQL snapshots of the account's D1 databases to R2, with retention pruning.
Closes the gap where 5 production databases (`florence-crm`, `eaton-ehs-dashboard`,
`ball-family-hq`, …) had **no backup path** — a bad migration or an accidental
`DELETE` was unrecoverable.

## What it does

- **Cron (nightly, 07:10 UTC):** dumps each bound database to
  `d1-backups/<db>/<YYYY-MM-DD>.sql` in R2 as restore-ready `CREATE TABLE` +
  `INSERT` statements (plus indexes/triggers/views).
- **Retention:** prunes snapshots older than `RETENTION_DAYS` (default 30).
- **On-demand HTTP** (guarded by `Authorization: Bearer <API_TOKEN>` once set):
  - `POST /backup` — run a full backup now.
  - `GET /backups?db=<name>` — list snapshots.
  - `GET /` — service info (open).

Sources are the `SOURCES` array in `src/index.js` and the matching
`[[d1_databases]]` blocks in `wrangler.toml`. Add or remove databases in both.

## One-time setup

1. **Enable R2** in the Cloudflare dashboard (R2 → *Enable*). This is the only
   step that must be done by hand — R2 is currently off on the account.
2. **Create the bucket** (and the kb-search index) — run the
   **“Setup R2 bucket + Vectorize index”** GitHub Action (Actions → Run
   workflow), or locally: `wrangler r2 bucket create d1-backups`.
3. **Deploy** — the *Deploy d1-backup* Action runs on pushes to `main` touching
   `worker/d1-backup/**`, or trigger it manually. (Requires repo secret
   `CLOUDFLARE_API_TOKEN`, same one the florence-crm-api deploy uses.)
4. **(Recommended)** set repo secret `BACKUP_API_TOKEN` to lock the manual
   endpoints — the deploy Action syncs it to the worker's `API_TOKEN` secret.

## Restore

```bash
wrangler r2 object get d1-backups/eaton-ehs-dashboard/2026-07-09.sql --file restore.sql
wrangler d1 execute eaton-ehs-dashboard --remote --file restore.sql
```

## Notes / limits

- The dump is assembled in Worker memory. Fine at current sizes (largest DB
  ~1.1 MB); revisit (stream / paginate) if a database grows into tens of MB.
- BLOB columns are not specially encoded — none exist in the current schemas.
