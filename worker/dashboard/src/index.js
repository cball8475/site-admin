// fsc-dashboard — serves the site-admin SPA and proxies its CRM calls.
//
// Why this exists: the dashboard used to call florence-crm-api directly with a
// bearer supplied via VITE_CRM_API_TOKEN. Vite inlines VITE_* vars at build
// time, so that bearer shipped inside the public JS bundle and anyone who
// loaded the dashboard could read the whole CRM (audit 2026-07-25, Finding 1).
//
// Now the browser calls same-origin /api/* with no credentials at all, and this
// worker attaches the bearer server-side from Secrets Store. The token never
// reaches the client.
//
// Routing: wrangler.toml sets run_worker_first = ["/api/*"], so this script runs
// for /api/* only. Everything else is served straight from static assets, with
// not_found_handling = "single-page-application" handling client-side routes.

const CORS_SAFE_REQUEST_HEADERS = ["content-type", "accept"];

function err(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Read the CRM bearer from the Secrets Store binding.
 *
 * Read per-request rather than cached in module scope so a rotation in Secrets
 * Store takes effect immediately, with no redeploy. Mirrors how eaton-ehs-api
 * reads its AUTH_TOKEN binding.
 */
async function readCrmToken(env) {
  if (!env.CRM_API_TOKEN || typeof env.CRM_API_TOKEN.get !== "function") {
    throw new Error(
      "CRM_API_TOKEN Secrets Store binding is missing — check [[secrets_store_secrets]] in wrangler.toml and that the API token used to deploy has Secrets Store (read) scope"
    );
  }
  const token = await env.CRM_API_TOKEN.get();
  if (!token) throw new Error("CRM_API_TOKEN resolved empty from Secrets Store");
  return token;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      // Defensive: run_worker_first should mean we never see these. If the
      // routing config is ever changed, fall back to assets rather than 404.
      return env.ASSETS ? env.ASSETS.fetch(request) : err("Not found", 404);
    }

    // Defense in depth, off by default. Cloudflare Access is the real gate and
    // it sits on this hostname; this only rejects requests that arrive without
    // Access having stamped its header. Presence is NOT signature verification
    // — it is meaningful because the hostname is only reachable through Access,
    // not because the header itself is trustworthy. Turn on by setting
    // REQUIRE_ACCESS = "true" once the Access policy is live and confirmed.
    if (env.REQUIRE_ACCESS === "true" && !request.headers.get("Cf-Access-Jwt-Assertion")) {
      return err("Unauthorized — request did not come through Cloudflare Access", 401);
    }

    const origin = env.CRM_ORIGIN;
    if (!origin) return err("CRM_ORIGIN var is not configured on this worker", 503);

    let token;
    try {
      token = await readCrmToken(env);
    } catch (e) {
      // Loud, not silent — a missing secret here breaks every dashboard tile,
      // and a 200 with empty data would send someone hunting in the wrong place.
      console.error("CRM bearer unavailable:", e.message || e);
      return err(`CRM bearer unavailable: ${e.message || e}`, 503);
    }

    // /api/prospects?x=1 → https://api.florencescservices.com/prospects?x=1
    const upstream = new URL(url.pathname.slice("/api".length) + url.search, origin);

    // Rebuild headers rather than forwarding wholesale: never pass the client's
    // Authorization through (a caller must not be able to substitute its own
    // bearer), and drop Cf-Access-* so upstream can't be confused by them.
    const headers = new Headers();
    for (const name of CORS_SAFE_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Authorization", `Bearer ${token}`);

    const init = { method: request.method, headers };
    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = await request.arrayBuffer();
    }

    let res;
    try {
      res = await fetch(upstream.toString(), init);
    } catch (e) {
      console.error("CRM upstream fetch failed:", upstream.pathname, e.message || e);
      return err(`CRM upstream unreachable: ${e.message || e}`, 502);
    }

    // Same-origin from the browser's perspective, so no CORS headers needed.
    // Strip upstream's Access-Control-* rather than pass them along confusingly.
    const outHeaders = new Headers(res.headers);
    for (const h of [...outHeaders.keys()]) {
      if (h.toLowerCase().startsWith("access-control-")) outHeaders.delete(h);
    }

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
    });
  },
};
