// fsc-dashboard — serves the site-admin SPA and proxies its CRM calls.
//
// ACCESS IS MANDATORY. Every request except /__health must carry a valid
// Cloudflare Access JWT. There is no bypass flag and no phased mode: if the
// Access vars are unset or the JWT fails verification, the request is refused.
//
// Two things this file assumes, both enforced in wrangler.toml:
//   1. workers_dev = false and preview_urls = false. A Worker is otherwise also
//      reachable at fsc-dashboard.<subdomain>.workers.dev and at per-version
//      preview URLs, neither of which the Access policy on
//      dashboard.florencescservices.com covers. Those are bypass hostnames.
//   2. run_worker_first = true, so this script runs for EVERY request including
//      the SPA shell and its assets — not just /api/*. Access at the edge is the
//      primary gate; this is the second lock that holds even if the Access
//      policy is removed, misapplied, or attached to the wrong hostname.
//
// Why signature verification and not a header presence check: Cloudflare's own
// guidance is that "validation of the header alone is not sufficient — the JWT
// and signature must be confirmed to avoid identity spoofing." A presence check
// is only meaningful if nothing can reach the origin except through Access, and
// that is an assumption about configuration rather than something the code
// enforces.
//
// Background: the CRM bearer used to be inlined into the public bundle by Vite,
// so anyone who loaded the dashboard could read the whole CRM (audit 2026-07-25,
// Finding 1). The browser now sends no credentials at all; the bearer is read
// here from Secrets Store and attached server-side.

import { jwtVerify, createRemoteJWKSet } from "jose";

const FORWARDED_REQUEST_HEADERS = ["content-type", "accept"];

// jose's remote JWK set caches keys and handles rotation with its own cooldown,
// so build it once per isolate rather than per request. Keyed by team domain so a
// config change can't be served from a stale set.
let jwksCache = { teamDomain: null, jwks: null };

function getJwks(teamDomain) {
  if (jwksCache.teamDomain !== teamDomain) {
    jwksCache = {
      teamDomain,
      jwks: createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`)),
    };
  }
  return jwksCache.jwks;
}

function deny(message, status = 403) {
  // text/plain and no-store: this is a security boundary, not an API surface.
  return new Response(`${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Verify the Cloudflare Access JWT. Throws on any failure — callers must treat a
 * thrown error as "refuse the request", never as "continue unauthenticated".
 */
async function requireAccess(request, env) {
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const policyAud = env.ACCESS_POLICY_AUD;

  // Unconfigured means locked, not open. A deploy that forgets these vars serves
  // 403 to everyone rather than silently dropping the gate.
  if (!teamDomain || !policyAud) {
    throw new Error(
      "Access is not configured on this worker (ACCESS_TEAM_DOMAIN / ACCESS_POLICY_AUD). Refusing all requests — see docs/dashboard-deploy.md"
    );
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new Error("No Cloudflare Access token on request");

  // Verifies signature against the team's published keys, and checks iss/aud/exp.
  const { payload } = await jwtVerify(token, getJwks(teamDomain), {
    issuer: teamDomain,
    audience: policyAud,
  });
  return payload;
}

async function readCrmToken(env) {
  if (!env.CRM_API_TOKEN || typeof env.CRM_API_TOKEN.get !== "function") {
    throw new Error(
      "CRM_API_TOKEN Secrets Store binding is missing — check [[secrets_store_secrets]] in wrangler.toml and that the deploying API token has Secrets Store (read) scope"
    );
  }
  // Read per-request so a rotation in Secrets Store applies without a redeploy.
  const token = await env.CRM_API_TOKEN.get();
  if (!token) throw new Error("CRM_API_TOKEN resolved empty from Secrets Store");
  return token;
}

async function proxyToCrm(request, url, env) {
  const origin = env.CRM_ORIGIN;
  if (!origin) return json({ error: "CRM_ORIGIN var is not configured" }, 503);

  let token;
  try {
    token = await readCrmToken(env);
  } catch (e) {
    // Loud, not silent — a 200 with empty data would send someone hunting in
    // entirely the wrong place.
    console.error("CRM bearer unavailable:", e.message || e);
    return json({ error: `CRM bearer unavailable: ${e.message || e}` }, 503);
  }

  // /api/prospects?x=1 → https://api.florencescservices.com/prospects?x=1
  const upstream = new URL(url.pathname.slice("/api".length) + url.search, origin);

  // Rebuild headers rather than forwarding wholesale: never pass the caller's
  // Authorization through (nobody gets to substitute their own bearer), and
  // don't leak Cf-Access-* upstream.
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
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
    return json({ error: `CRM upstream unreachable: ${e.message || e}` }, 502);
  }

  // Same-origin from the browser's view, so strip upstream CORS rather than
  // pass it along confusingly.
  const outHeaders = new Headers(res.headers);
  for (const h of [...outHeaders.keys()]) {
    if (h.toLowerCase().startsWith("access-control-")) outHeaders.delete(h);
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: outHeaders,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // The ONLY unauthenticated route. Reports deployment and configuration
    // sanity so a deploy can be verified while the app stays fully locked.
    // Deliberately makes no upstream call and touches no secret value, so it
    // reveals nothing about the CRM or whether the bearer is valid.
    if (url.pathname === "/__health") {
      return json({
        status: "ok",
        worker: "fsc-dashboard",
        access_configured: Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_POLICY_AUD),
        crm_binding_present:
          Boolean(env.CRM_API_TOKEN) && typeof env.CRM_API_TOKEN?.get === "function",
        crm_origin_configured: Boolean(env.CRM_ORIGIN),
      });
    }

    try {
      await requireAccess(request, env);
    } catch (e) {
      // Don't echo the reason for a token failure to the caller; log it instead.
      console.error("Access denied:", e.message || e);
      return deny("Forbidden — Cloudflare Access authentication required");
    }

    if (url.pathname.startsWith("/api/")) {
      return proxyToCrm(request, url, env);
    }

    // Authenticated: serve the SPA. The assets binding honours
    // not_found_handling = "single-page-application", so client-side routes
    // resolve to index.html on refresh.
    if (!env.ASSETS) return deny("Assets binding missing", 500);
    return env.ASSETS.fetch(request);
  },
};
