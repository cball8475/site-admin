// florence-outreach — v2.0.0 (secured Claude proxy)
//
// Powers the dashboard's "generate copy" buttons: POST / with an Anthropic
// Messages payload ({model?, max_tokens?, messages}) returns the raw
// Anthropic response.
//
// v1 was an OPEN proxy — no auth at all, so anyone could burn the Anthropic
// key. v2 requires a Bearer token on every POST, validated by delegation to
// the CRM API's /auth/check (this worker stores no extra secret), with a
// short in-isolate cache. CORS answers only for the dashboard origins; the
// dashboard reaches this worker through florence-dashboard-proxy (/outreach/*)
// which injects the token server-side behind Cloudflare Access.
//
// The old /email-search route the dashboard used to call never existed here;
// the real email finder now lives on the outreach engine
// (florence-auto-outreach-emails POST /email-search).

const VERSION = "2.0.0";
const CRM_API_URL = "https://api.florencescservices.com";
const ALLOWED_ORIGINS = [
  "https://dashboard.florencescservices.com",
  "https://florence-dashboard.pages.dev",
  "http://localhost:5173",
  "http://localhost:4173"
];
const MAX_TOKENS_CAP = 4000;
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
}

// Token validation by delegation: a bearer is good if the CRM API accepts it.
// Cached ~5 minutes per isolate so the hub isn't hit on every keystroke.
const validCache = new Map();
async function bearerIsValid(bearer) {
  if (!bearer) return false;
  const exp = validCache.get(bearer);
  if (exp && exp > Date.now()) return true;
  try {
    const res = await fetch(`${CRM_API_URL}/auth/check`, { headers: { Authorization: `Bearer ${bearer}` } });
    if (res.ok) {
      validCache.set(bearer, Date.now() + 5 * 60 * 1000);
      return true;
    }
  } catch {}
  return false;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    const jsonHeaders = { "Content-Type": "application/json", ...cors };
    if (request.method !== "POST") {
      return new Response(JSON.stringify({
        service: `florence-outreach v${VERSION} — secured Claude proxy`,
        usage: "POST / with {model?, max_tokens?, messages} and Authorization: Bearer <CRM token>",
        note: "email search moved to the outreach engine: POST https://florence-auto-outreach-emails.cball8475.workers.dev/email-search"
      }), { status: request.method === "GET" ? 200 : 405, headers: jsonHeaders });
    }

    const auth = request.headers.get("Authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!(await bearerIsValid(bearer))) {
      return new Response(JSON.stringify({ error: "unauthorized — Bearer token required (validated against the CRM API)" }), { status: 401, headers: jsonHeaders });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500, headers: jsonHeaders });
    }

    try {
      const body = await request.json();
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return new Response(JSON.stringify({ error: "messages[] required" }), { status: 400, headers: jsonHeaders });
      }
      const model = typeof body.model === "string" && body.model.startsWith("claude-") ? body.model : DEFAULT_MODEL;
      const maxTokens = Math.min(Number(body.max_tokens) || 1000, MAX_TOKENS_CAP);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: body.messages })
      });
      const data = await res.text();
      return new Response(data, { status: res.status, headers: jsonHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders });
    }
  }
};
