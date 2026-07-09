// d1-backup — nightly SQL snapshots of D1 databases to R2.
//
// The cron handler dumps each bound database to R2 as restore-ready
// CREATE TABLE + INSERT SQL, then prunes snapshots older than RETENTION_DAYS.
// A token-guarded HTTP surface lets you run a backup or list snapshots on demand.
//
// Bindings (see wrangler.toml): one D1 binding per source (DB_EATON, DB_CRM,
// DB_FAMILY), R2 bucket BACKUPS, var RETENTION_DAYS, secret API_TOKEN.

const SOURCES = [
  { binding: "DB_EATON", name: "eaton-ehs-dashboard" },
  { binding: "DB_CRM", name: "florence-crm" },
  { binding: "DB_FAMILY", name: "ball-family-hq" },
  { binding: "DB_BHE", name: "before-human-error" },
  { binding: "DB_TINY", name: "tiny-mountain-65c7" },
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Serialize a D1 cell to a SQLite literal.
function sqlLiteral(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "bigint") return String(v);
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return "'" + s.replace(/'/g, "''") + "'";
}

// Build a full SQL dump (schema + data + indexes/triggers/views) for one DB.
async function dumpDatabase(db) {
  const schema = await db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master " +
        "WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND sql IS NOT NULL " +
        "ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name"
    )
    .all();

  const tables = schema.results.filter((o) => o.type === "table");
  const others = schema.results.filter((o) => o.type !== "table");

  let out = "-- d1-backup snapshot\nPRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n";

  for (const t of tables) {
    out += `DROP TABLE IF EXISTS "${t.name}";\n${t.sql.trim()};\n`;
    const rows = await db.prepare(`SELECT * FROM "${t.name}"`).all();
    for (const row of rows.results) {
      const cols = Object.keys(row);
      const colList = cols.map((c) => `"${c}"`).join(", ");
      const valList = cols.map((c) => sqlLiteral(row[c])).join(", ");
      out += `INSERT INTO "${t.name}" (${colList}) VALUES (${valList});\n`;
    }
  }

  for (const o of others) out += `${o.sql.trim()};\n`;

  out += "COMMIT;\nPRAGMA foreign_keys=ON;\n";
  return out;
}

async function backupSource(env, src, stamp) {
  const db = env[src.binding];
  if (!db) return { db: src.name, ok: false, error: `binding ${src.binding} missing` };
  try {
    const sql = await dumpDatabase(db);
    const key = `d1-backups/${src.name}/${stamp}.sql`;
    await env.BACKUPS.put(key, sql, { httpMetadata: { contentType: "application/sql" } });
    return { db: src.name, ok: true, key, bytes: sql.length };
  } catch (e) {
    return { db: src.name, ok: false, error: String((e && e.message) || e) };
  }
}

async function pruneSource(env, src, retentionDays) {
  if (!(retentionDays > 0)) return { db: src.name, pruned: 0 };
  const cutoff = Date.now() - retentionDays * 86400000;
  const prefix = `d1-backups/${src.name}/`;
  let pruned = 0;
  let cursor;
  do {
    const list = await env.BACKUPS.list({ prefix, cursor });
    for (const obj of list.objects) {
      const m = obj.key.match(/(\d{4}-\d{2}-\d{2})\.sql$/);
      if (m && new Date(`${m[1]}T00:00:00Z`).getTime() < cutoff) {
        await env.BACKUPS.delete(obj.key);
        pruned++;
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return { db: src.name, pruned };
}

async function runBackup(env) {
  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const retention = parseInt(env.RETENTION_DAYS || "30", 10);
  const backups = [];
  const prunes = [];
  for (const src of SOURCES) {
    backups.push(await backupSource(env, src, stamp));
    prunes.push(await pruneSource(env, src, retention));
  }
  return { stamp, backups, prunes };
}

function authorized(request, env) {
  if (!env.API_TOKEN) return true; // no token set -> open; set one to lock down
  return (request.headers.get("Authorization") || "") === `Bearer ${env.API_TOKEN}`;
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runBackup(env).then((r) => console.log("d1-backup:", JSON.stringify(r))));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/") {
      return json({
        service: "d1-backup",
        sources: SOURCES.map((s) => s.name),
        destination: "r2://d1-backups/d1-backups/<db>/<YYYY-MM-DD>.sql",
        retention_days: parseInt(env.RETENTION_DAYS || "30", 10),
      });
    }

    if (url.pathname === "/backup" && request.method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      return json(await runBackup(env));
    }

    if (url.pathname === "/backups" && request.method === "GET") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      const dbFilter = url.searchParams.get("db");
      const prefix = dbFilter ? `d1-backups/${dbFilter}/` : "d1-backups/";
      const list = await env.BACKUPS.list({ prefix });
      return json({
        count: list.objects.length,
        objects: list.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })),
      });
    }

    return json({ error: "not found" }, 404);
  },
};
