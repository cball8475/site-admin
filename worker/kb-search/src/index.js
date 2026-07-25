// kb-search — semantic search over the EATON knowledge base.
//
// Embeds the free-text "institutional memory" tables from eaton-ehs-dashboard
// with Workers AI (bge-base-en-v1.5, 768-dim) into a Vectorize index, then
// answers natural-language queries against it ("what do I know about supplier X").
//
// Bindings (see wrangler.toml): D1 'DB', Workers AI 'AI', Vectorize 'VEC',
// var EMBED_MODEL, secret API_TOKEN.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Each entry maps a table to the text we embed and the title we show.
// Add Florence/FSC memory later by appending entries (and a second D1 binding).
const CORPUS = [
  {
    table: "knowledge",
    title: (r) => r.subject || "(knowledge)",
    text: (r) => [r.category, r.area, r.subject, r.detail, r.people_involved, r.tags].filter(Boolean).join(" — "),
  },
  {
    table: "tribal_knowledge",
    where: "superseded_by IS NULL",
    title: (r) => r.topic || "(tribal knowledge)",
    text: (r) => [r.category, r.topic, r.content, r.source_person, r.tags].filter(Boolean).join(" — "),
  },
  {
    table: "people_intel",
    title: (r) => r.person_name || "(intel)",
    text: (r) => [r.person_name, r.intel_type, r.content].filter(Boolean).join(" — "),
  },
  {
    table: "leadership_moves",
    title: (r) => (r.description || "(leadership move)").slice(0, 80),
    text: (r) => [r.date, r.category, r.description, r.context, r.people_involved].filter(Boolean).join(" — "),
  },
  {
    table: "weekly_reflections",
    title: (r) => "Week of " + (r.week_of || "?"),
    text: (r) => [r.influenced_vs_executed, r.clarity_created, r.learned_about_eaton, r.time_allocation_note].filter(Boolean).join(" — "),
  },
];

const CORPUS_BY_TABLE = Object.fromEntries(CORPUS.map((c) => [c.table, c]));

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Returns an array of embedding vectors, one per input string.
async function embed(env, input) {
  const model = env.EMBED_MODEL || "@cf/baai/bge-base-en-v1.5";
  const res = await env.AI.run(model, { text: input });
  return res.data;
}

async function reindex(env) {
  // Pre-flight: verify every corpus table exists BEFORE upserting anything.
  // Failing midway used to leave the index partially updated with no signal;
  // failing up front is atomic-ish and names the actual problem.
  const missing = [];
  for (const entry of CORPUS) {
    const t = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).bind(entry.table).first();
    if (!t) missing.push(entry.table);
  }
  if (missing.length) {
    throw new Error(
      `reindex aborted — corpus table(s) missing from D1: ${missing.join(", ")}. ` +
      "Remove the entry from CORPUS if the table was retired."
    );
  }

  const corpus = [];
  for (const entry of CORPUS) {
    const sql = `SELECT * FROM "${entry.table}"` + (entry.where ? ` WHERE ${entry.where}` : "");
    const rows = (await env.DB.prepare(sql).all()).results;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 96) {
      const batch = rows.slice(i, i + 96);
      const texts = batch.map((r) => entry.text(r) || entry.title(r) || "(empty)");
      const vectors = await embed(env, texts);
      const items = batch.map((r, j) => ({
        id: `${entry.table}:${r.id}`,
        values: vectors[j],
        metadata: {
          source: "eaton",
          table: entry.table,
          row_id: r.id,
          title: String(entry.title(r) || "").slice(0, 200),
        },
      }));
      await env.VEC.upsert(items);
      upserted += items.length;
    }
    corpus.push({ table: entry.table, rows: rows.length, upserted });
  }
  return { indexed_at: new Date().toISOString(), corpus };
}

async function search(env, q, topK) {
  const [qv] = await embed(env, q);
  const res = await env.VEC.query(qv, { topK, returnMetadata: "all" });
  const matches = [];
  const stale = []; // vector ids whose D1 row is gone or superseded
  for (const m of res.matches || []) {
    const md = m.metadata || {};
    const entry = CORPUS_BY_TABLE[md.table];
    // Reindex only ever upserts, so a row deleted or superseded in D1 lives on
    // in the index. Never serve those as live hits — drop them from results
    // and queue the vector for deletion so the index self-heals.
    if (!entry || md.row_id == null) {
      stale.push(m.id);
      continue;
    }
    const row = await env.DB.prepare(`SELECT * FROM "${md.table}" WHERE id = ?`).bind(md.row_id).first();
    if (!row || ("superseded_by" in row && row.superseded_by != null)) {
      stale.push(m.id);
      continue;
    }
    matches.push({
      score: Math.round((m.score || 0) * 1000) / 1000,
      table: md.table,
      title: md.title,
      snippet: entry.text(row).slice(0, 500),
      id: m.id,
    });
  }
  return { query: q, matches, stale };
}

function authorized(request, env) {
  // Fail closed: this index serves people_intel — candid notes on named
  // coworkers. An unset token must mean locked, never public. The deploy
  // workflow refuses to deploy without KB_API_TOKEN set.
  if (!env.API_TOKEN) return false;
  return (request.headers.get("Authorization") || "") === `Bearer ${env.API_TOKEN}`;
}

export default {
  // reindex() throws on failure, and an unhandled rejection inside waitUntil
  // marks the invocation failed in Cloudflare — a cron that swallows its own
  // errors reports success forever (see EATON worker-api.mjs v3.9.3).
  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      const r = await reindex(env);
      console.log("kb-search reindex:", JSON.stringify(r));
    })());
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/") {
      return json({
        service: "kb-search",
        corpus: CORPUS.map((c) => c.table),
        model: env.EMBED_MODEL || "@cf/baai/bge-base-en-v1.5",
      });
    }

    if (url.pathname === "/reindex" && request.method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      return json(await reindex(env));
    }

    if (url.pathname === "/search") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
      const q = url.searchParams.get("q");
      if (!q) return json({ error: "q required" }, 400);
      const k = Math.min(parseInt(url.searchParams.get("k") || "5", 10), 20);
      const result = await search(env, q, k);
      if (result.stale.length) {
        console.log("kb-search: purging stale vectors:", result.stale.join(", "));
        ctx.waitUntil(env.VEC.deleteByIds(result.stale).catch((e) =>
          console.error("kb-search: stale vector purge failed:", e.message || e)));
      }
      const { stale, ...body } = result;
      return json({ ...body, stale_purged: stale.length });
    }

    return json({ error: "not found" }, 404);
  },
};
