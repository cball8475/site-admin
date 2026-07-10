// florence-auto-outreach-emails — Outreach Engine v2.0.0
//
// The supply-side recruiting engine for Florence SC Services: finds local
// dumpster / junk-hauling operators, filters out lead-gen sites and national
// chains, scrapes an email off their website, adds them to the CRM, enrolls
// them in a 5-touch Resend sequence (respecting one-operator-per-zone
// exclusivity), sends due steps, and emails Charlie a daily digest.
//
// Pipeline runs Mon–Fri at 12:00 UTC via cron, in self-chained phases so no
// single invocation blows the Workers subrequest budget:
//   discover → process (batches) → send → digest
// Each phase re-invokes POST /trigger?phase=… on this worker, self-authed
// with CRM_API_TOKEN.
//
// Safety rails:
//   • D1 kill switch (outreach_toggle) defaults to PAUSED — while paused the
//     engine still discovers/adds/enrolls (a live dry-run, fully logged) but
//     sends nothing to prospects; the digest still goes to Charlie.
//   • OUTREACH_PAUSED env var is a hard override on top of the D1 toggle.
//   • suppression table checked before EVERY send; unsubscribes are permanent.
//   • A sequence step is marked sent ONLY after Resend returns 2xx.
//   • Per-run send cap + delay between sends.
//
// Every meaningful action lands in the D1 outreach_log table.
//
// Auth on admin endpoints: Bearer CRM_API_TOKEN (same token as the CRM API),
// or ADMIN_SECRET, or the CI-rotated SMOKE_TOKEN. /unsubscribe and /preflight
// are public (the latter returns booleans only).

import { WorkerEntrypoint } from "cloudflare:workers";

var VERSION = "2.1.0";
var FROM_EMAIL = "charlie@florencescservices.com";
var FROM_NAME = "Charlie — Florence SC Services";
var DIGEST_TO = "charlie@florencescservices.com";
var PUBLIC_URL = "https://florence-auto-outreach-emails.cball8475.workers.dev";
var CRM_API_URL_DEFAULT = "https://api.florencescservices.com";
var COMPANY_ADDRESS = "10685-B Hazelhurst Dr. #43191, Houston, TX 77043";
var COMPANY_PHONE = "(833) 968-3306";

var MAX_EMAILS_PER_RUN = 10;   // per-run send cap (deliverability + subrequest budget)
var SEND_DELAY_MS = 1500;      // pause between sends
var PROCESS_BATCH = 6;         // queue items handled per process invocation
var SCRAPE_TIMEOUT_MS = 8000;
var DISCOVERY_CENTER = { latitude: 34.1954, longitude: -79.7626 };
var DISCOVERY_RADIUS_M = 50000;

// ── Verticals ────────────────────────────────────────────────────────────────
var VERTICALS = {
  dumpster: {
    sequence: "new_prospect",
    queries: ["dumpster rental", "roll off dumpster rental", "dumpster rental service"],
    searchExample: "dumpster rental Florence SC",
    leadsNoun: "dumpster leads",
    requestsNoun: "dumpster requests",
    needPhrase: "needing a dumpster",
    proofJob: "a $400 dumpster rental"
  },
  hauling: {
    sequence: "hauling_new_prospect",
    queries: ["junk removal", "junk hauling service", "cleanout service"],
    searchExample: "junk removal Florence SC",
    leadsNoun: "junk removal leads",
    requestsNoun: "junk removal and cleanout calls",
    needPhrase: "needing junk hauled off",
    proofJob: "a $400 job"
  }
};

// ── Zones (kept in sync with florence-crm-api detectZone) ───────────────────
var ZONE_NAMES = {
  "1": "Florence",
  "2": "Grand Strand",
  "3": "Georgetown / Williamsburg",
  "4": "Darlington County",
  "5": "Marion / Dillon",
  "6": "Chesterfield / Marlboro",
  "7": "Sumter / Lee / Clarendon"
};
var ZONE_CITY_HINT = { "1": "florence", "2": "myrtle beach", "3": "georgetown", "4": "darlington", "5": "marion", "6": "cheraw", "7": "sumter" };
var ZIP_ZONES = {
  "29501": "1", "29502": "1", "29503": "1", "29504": "1", "29505": "1", "29506": "1", "29161": "1", "29555": "1", "29580": "1", "29583": "1", "29541": "1", "29560": "1",
  "29526": "2", "29527": "2", "29566": "2", "29568": "2", "29569": "2", "29572": "2", "29575": "2", "29576": "2", "29577": "2", "29578": "2", "29579": "2", "29582": "2",
  "29440": "3", "29442": "3", "29443": "3", "29444": "3", "29556": "3", "29554": "3",
  "29532": "4", "29550": "4", "29551": "4", "29069": "4", "29067": "4",
  "29571": "5", "29574": "5", "29536": "5", "29565": "5", "29563": "5", "29511": "5",
  "29512": "6", "29520": "6", "29516": "6", "29101": "6", "29728": "6", "29009": "6", "29030": "6",
  "29150": "7", "29151": "7", "29152": "7", "29153": "7", "29154": "7", "29102": "7", "29010": "7", "29162": "7", "29104": "7", "29128": "7"
};
var CITY_ZONES = {
  "1": ["florence", "effingham", "timmonsville", "johnsonville", "scranton", "coward", "quinby", "pamplico", "lake city"],
  "2": ["myrtle beach", "conway", "surfside", "murrells inlet", "north myrtle", "little river", "longs", "loris", "aynor"],
  "3": ["georgetown", "andrews", "kingstree", "hemingway", "williamsburg"],
  "4": ["darlington", "hartsville", "lamar", "society hill", "dovesville"],
  "5": ["marion", "mullins", "dillon", "latta", "lake view", "nichols"],
  "6": ["bennettsville", "cheraw", "chesterfield", "pageland", "mcbee", "patrick", "jefferson"],
  "7": ["sumter", "manning", "bishopville", "turbeville", "pinewood", "clarendon"]
};
function detectZone(text) {
  const v = (text || "").toLowerCase();
  const zipMatch = v.match(/\b(\d{5})\b/);
  if (zipMatch && ZIP_ZONES[zipMatch[1]]) return ZIP_ZONES[zipMatch[1]];
  for (const [zone, cities] of Object.entries(CITY_ZONES)) {
    if (cities.some((c) => v.includes(c))) return zone;
  }
  return null;
}

// ── Auto-reject filters ──────────────────────────────────────────────────────
// Lead-gen / marketing / directory outfits — we recruit operators, not middlemen.
var LEADGEN_PATTERNS = [
  /\bangi\b/i, /angie'?s list/i, /thumbtack/i, /\byelp\b/i, /networx/i,
  /homeadvisor/i, /home advisor/i, /\bporch\b/i, /craftjack/i, /\bbark\b/i,
  /\bleads?\b/i, /lead ?gen/i, /marketing/i, /\bseo\b/i, /advertis/i,
  /directory/i, /\bmedia\b/i, /web ?design/i, /\bagency\b/i
];
// National chains, big haulers, franchises, brokers — not local independents.
var CHAIN_PATTERNS = [
  /waste management/i, /\bwm\b(?![a-z])/i, /republic services/i, /waste connections/i,
  /\bgfl\b/i, /green for life/i, /waste pro/i, /casella/i, /rumpke/i, /advanced disposal/i,
  /1[\s-]?800[\s-]?got[\s-]?junk/i, /college hunks/i, /junk king/i, /junkluggers/i,
  /bin there dump that/i, /redbox\+/i, /smash my trash/i, /servpro/i, /servicemaster/i,
  /budget dumpster/i, /dumpsters\.com/i, /hometown dumpster/i, /vine disposal/i,
  /capital waste/i
];
var CHAIN_DOMAINS = [
  "wm.com", "republicservices.com", "wasteconnections.com", "gflenv.com",
  "wasteprousa.com", "casella.com", "rumpke.com", "1800gotjunk.com",
  "collegehunkshaulingjunk.com", "junk-king.com", "junkluggers.com",
  "bintheredumpthat.com", "budgetdumpster.com", "dumpsters.com",
  "hometowndumpster.com", "angi.com", "thumbtack.com", "yelp.com", "networx.com",
  "homeadvisor.com", "porch.com", "capitalwaste.com", "servpro.com"
];
// Disposal facilities / government sites — places you DUMP at, not operators
// who rent out dumpsters or haul junk. Never pitch these.
var FACILITY_PATTERNS = [
  /landfill/i, /transfer station/i, /recycling? cent(er|re)/i, /convenience cent(er|re)/i,
  /\bcounty\b/i, /municipal/i, /public works/i, /solid waste authority/i
];
// Places text search drifts into adjacent categories (maids, pressure
// washing, laundromats under "cleanout service"). The business must actually
// look like the vertical before we ever contact it.
var RELEVANT_PATTERNS = {
  dumpster: /dumpster|roll[\s-]?off|container|waste|disposal|trash|debris|junk|sanitation|\bbins?\b/i,
  hauling: /junk|haul|removal|clean[\s-]?out|debris|trash|waste|disposal|dumpster|demolition|scrap/i
};

// ── Small helpers ────────────────────────────────────────────────────────────
var CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS });
}
function normName(s) {
  return (s || "").toLowerCase().replace(/\b(llc|inc|co|corp|company|services?|of sc)\b/g, "").replace(/[^a-z0-9]/g, "");
}
function normPhone(s) {
  const d = (s || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}
function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}
function newRunId() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `r_${d}_${Math.random().toString(36).slice(2, 6)}`;
}
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
async function unsubscribeUrlFor(env, prospectId) {
  const id = String(prospectId);
  const token = env.UNSUB_SECRET ? `&t=${await hmac(id, env.UNSUB_SECRET)}` : "";
  return `${PUBLIC_URL}/unsubscribe?id=${encodeURIComponent(id)}${token}`;
}
function isAuthed(request, url, env) {
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const key = url.searchParams.get("key") || "";
  const candidates = [env.CRM_API_TOKEN, env.ADMIN_SECRET, env.SMOKE_TOKEN].filter(Boolean);
  return candidates.some((c) => bearer === c || key === c);
}
async function crmAPI(env, path, method = "GET", body = null) {
  const base = env.CRM_API_URL || CRM_API_URL_DEFAULT;
  const opts = { method, headers: { "Authorization": `Bearer ${env.CRM_API_TOKEN}`, "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${path}`, opts);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const e = new Error(`CRM API ${method} ${path}: ${res.status}: ${text.slice(0, 200)}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

// ── D1 schema (self-ensured; shared with florence-crm-api) ──────────────────
var TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS outreach_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT DEFAULT (datetime('now')),
    run_id TEXT,
    source TEXT DEFAULT 'engine',
    event TEXT NOT NULL,
    prospect_id TEXT,
    place_id TEXT,
    name TEXT,
    email TEXT,
    zone TEXT,
    detail TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_outreach_log_ts ON outreach_log(ts)`,
  `CREATE INDEX IF NOT EXISTS idx_outreach_log_event ON outreach_log(event)`,
  `CREATE INDEX IF NOT EXISTS idx_outreach_log_run ON outreach_log(run_id)`,
  `CREATE TABLE IF NOT EXISTS suppression (
    email TEXT PRIMARY KEY,
    reason TEXT DEFAULT 'unsubscribed',
    prospect_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS data_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS outreach_queue (
    place_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    processed_at TEXT,
    note TEXT
  )`
];
var schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  for (const sql of TABLES_SQL) await db.prepare(sql).run();
  schemaReady = true;
}
async function logRow(env, { run_id, source, event, prospect_id, place_id, name, email, zone, detail }) {
  try {
    await ensureSchema(env.DB);
    await env.DB.prepare(
      "INSERT INTO outreach_log (run_id, source, event, prospect_id, place_id, name, email, zone, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(run_id || null, source || "engine", event, prospect_id || null, place_id || null, name || null, email || null, zone || null, detail == null ? null : typeof detail === "string" ? detail : JSON.stringify(detail)).run();
  } catch (e) {
    console.error("outreach_log write failed:", e.message, event);
  }
}
async function getToggle(env) {
  await ensureSchema(env.DB);
  const row = await env.DB.prepare("SELECT value FROM data_store WHERE key = 'outreach_toggle'").first();
  if (!row) {
    // Fail safe: engine never cold-emails until Charlie explicitly unpauses.
    const t = { paused: true, reason: "default safe state — never unpaused", updated_at: new Date().toISOString(), updated_by: "system" };
    await env.DB.prepare("INSERT OR REPLACE INTO data_store (key, value, updated_at) VALUES ('outreach_toggle', ?, datetime('now'))").bind(JSON.stringify(t)).run();
    return t;
  }
  try { return JSON.parse(row.value); } catch { return { paused: true, reason: "unparseable toggle — failing safe" }; }
}
async function setToggle(env, paused, reason, actor) {
  await ensureSchema(env.DB);
  const t = { paused: !!paused, reason: reason || null, updated_at: new Date().toISOString(), updated_by: actor || "engine" };
  await env.DB.prepare("INSERT OR REPLACE INTO data_store (key, value, updated_at) VALUES ('outreach_toggle', ?, datetime('now'))").bind(JSON.stringify(t)).run();
  await logRow(env, { event: "toggle", source: actor || "engine", detail: { paused: t.paused, reason: t.reason } });
  return t;
}
async function isSuppressed(env, email) {
  if (!email) return false;
  await ensureSchema(env.DB);
  const row = await env.DB.prepare("SELECT email FROM suppression WHERE email = ?").bind(email.trim().toLowerCase()).first();
  return !!row;
}
async function suppress(env, email, reason, prospectId) {
  if (!email) return;
  await ensureSchema(env.DB);
  await env.DB.prepare(
    "INSERT INTO suppression (email, reason, prospect_id) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET reason = excluded.reason, prospect_id = COALESCE(excluded.prospect_id, suppression.prospect_id)"
  ).bind(email.trim().toLowerCase(), reason || "unsubscribed", prospectId || null).run();
}
async function getPlacesKey(env) {
  if (env.GOOGLE_PLACES_API_KEY) return { key: env.GOOGLE_PLACES_API_KEY, source: "env" };
  try {
    await ensureSchema(env.DB);
    const row = await env.DB.prepare("SELECT value FROM data_store WHERE key = 'google_places_api_key'").first();
    if (row && row.value) return { key: JSON.parse(row.value), source: "d1_config" };
  } catch (e) { console.error("places key config read failed:", e.message); }
  return { key: null, source: "missing" };
}

// ── Email sending (Resend; 2xx or it did not happen) ─────────────────────────
function emailFooter(unsubscribeUrl) {
  let footer = `\n\n—\nFlorence SC Services \xB7 ${COMPANY_ADDRESS} \xB7 ${COMPANY_PHONE}`;
  if (unsubscribeUrl) footer += `\nPrefer not to hear from us? One click and you're out: ${unsubscribeUrl}`;
  return footer;
}
async function sendEmailResend(env, { to, subject, html, text, from, headers }) {
  if (!env.RESEND_API_KEY) return { ok: false, status: 0, error: "RESEND_API_KEY not configured" };
  const fromAddr = from || `${env.FROM_NAME || FROM_NAME} <${env.FROM_EMAIL || FROM_EMAIL}>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromAddr,
        to: [to],
        subject,
        ...html ? { html } : {},
        ...text ? { text } : {},
        ...headers && Object.keys(headers).length ? { headers } : {}
      })
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      return { ok: false, status: res.status, error: (data && (data.message || data.name)) || `resend_${res.status}` };
    }
    return { ok: true, status: res.status, id: data && data.id || null };
  } catch (e) {
    return { ok: false, status: 0, error: e.message || String(e) };
  }
}
// Outreach send wrapper: suppression check + CAN-SPAM footer + one-click
// List-Unsubscribe headers. Used for prospect-facing sequence emails.
async function sendOutreachEmail(env, prospect, subject, body) {
  const to = (prospect.email || "").trim();
  if (!to) return { ok: false, status: 0, error: "no_email" };
  if (await isSuppressed(env, to)) return { ok: false, status: 0, error: "suppressed", suppressed: true };
  if (COMPANY_ADDRESS.includes("ADD YOUR MAILING ADDRESS")) {
    return { ok: false, status: 0, error: "COMPANY_ADDRESS placeholder not replaced (CAN-SPAM)" };
  }
  const unsubscribeUrl = await unsubscribeUrlFor(env, prospect.id);
  const fromEmail = env.FROM_EMAIL || FROM_EMAIL;
  const headers = {
    "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${fromEmail}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
  };
  return sendEmailResend(env, { to, subject, text: body + emailFooter(unsubscribeUrl), headers });
}

// ── The 5-touch sequence copy ────────────────────────────────────────────────
// Voice: a sharp local operator, not a SaaS drip. Every touch carries the
// offer naturally: exclusive leads, ONE operator per zone, 1 month free (no
// card, no contract), zones are first-come-first-serve. Day spacing 0/2/5/8/12.
var SEQUENCES = {
  new_prospect: { name: "New Prospect — 5 Touch (dumpster)", vertical: "dumpster", steps: [
    { day: 0, type: "email", label: "Intro" },
    { day: 2, type: "email", label: "Follow-up" },
    { day: 5, type: "email", label: "Not-Angi" },
    { day: 8, type: "email", label: "Proof + first-come" },
    { day: 12, type: "email", label: "Last call" }
  ] },
  hauling_new_prospect: { name: "New Prospect — 5 Touch (hauling)", vertical: "hauling", steps: [
    { day: 0, type: "email", label: "Intro" },
    { day: 2, type: "email", label: "Follow-up" },
    { day: 5, type: "email", label: "Not-Angi" },
    { day: 8, type: "email", label: "Proof + first-come" },
    { day: 12, type: "email", label: "Last call" }
  ] }
};
function mergeFields(prospect) {
  const first = (prospect.contact_name || "there").trim().split(/\s+/)[0] || "there";
  const company = prospect.short_name || prospect.name || "your company";
  const zone = prospect.default_zone && ZONE_NAMES[String(prospect.default_zone)] ? String(prospect.default_zone) : null;
  const zoneLabel = zone ? `the ${ZONE_NAMES[zone]} zone` : "your area";
  const cityHint = zone ? ZONE_CITY_HINT[zone] : "the pee dee";
  return { first, company, zoneLabel, cityHint };
}
function generateEmailContent(env, prospect, stepIndex) {
  const vKey = (prospect.vertical || "dumpster") === "hauling" ? "hauling" : "dumpster";
  const V = VERTICALS[vKey];
  const { first, company, zoneLabel, cityHint } = mergeFields(prospect);
  const templates = [
    {
      subject: `${V.leadsNoun} in ${cityHint}`,
      body: `Hi ${first},

I run florencescservices.com — Google "${V.searchExample}" and you'll find me on page one. People ${V.needPhrase} in ${zoneLabel} land there every week, and right now I have no local operator to send them to.

The model is simple: one operator per zone, period. Nothing gets blasted to five companies the way Angi does it. A lead from your area goes to you and nobody else.

Your first month is free — no card, no contract. Work the leads, keep the jobs, then decide if it's worth paying for.

Want ${company} to be where ${zoneLabel} leads go? Reply "yes" and it's yours.

Charlie
Florence SC Services \xB7 ${COMPANY_PHONE}`
    },
    {
      subject: `re: ${V.leadsNoun} in ${cityHint}`,
      body: `Hi ${first},

Quick follow-up — ${zoneLabel} is still open on my end, which means ${V.requestsNoun} from there are coming in with no local operator attached.

The free month starts whenever you say the word. No card, no contract, just leads while you decide if they're any good.

Worth a look?

Charlie`
    },
    {
      subject: `not another angi pitch`,
      body: `Hi ${first},

You've probably been burned by lead sites: pay up front, then race four other companies to a phone number they all bought. I built the opposite.

When someone finds my site ${V.needPhrase} in ${zoneLabel}, that lead goes to one operator. If that's you, it's you every time. No shared leads, no bidding, no pay-per-dud.

It's also why I can only take one company per zone — and why ${zoneLabel} being open right now actually means something.

First month's free to prove it. Reply and I'll set ${company} up.

Charlie`
    },
    {
      subject: `what one lead turned into`,
      body: `Hi ${first},

Real number: back in March I sent a partner a single lead — he closed ${V.proofJob} off it within two hours. One lead, one job, nobody else calling that customer.

I bring it up because ${zoneLabel} is still unclaimed, and I pitch every operator in the area eventually. Zones are first come, first serve — whoever claims one locks it, free month included, and everyone else in that zone is out of luck.

I'd rather it be ${company}. Reply "claim it" and ${zoneLabel} comes off the market.

Charlie`
    },
    {
      subject: `closing the loop`,
      body: `Hi ${first},

Last note from me — you run a real business and I'm not going to keep cluttering the inbox.

The offer stands while ${zoneLabel} stays open: exclusive ${V.leadsNoun}, one operator per zone, first month free, no card, no contract. The day someone else claims it, it's gone and you won't hear about it from me again.

If it's ever a fit, just reply. Either way — busy season to you.

Charlie
Florence SC Services`
    }
  ];
  return templates[stepIndex] || templates[0];
}

// ── Google Places discovery ──────────────────────────────────────────────────
async function placesSearch(key, textQuery) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus"
    },
    body: JSON.stringify({
      textQuery,
      maxResultCount: 20,
      locationBias: { circle: { center: DISCOVERY_CENTER, radius: DISCOVERY_RADIUS_M } }
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Places API ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data.places) ? data.places : [];
}
function classifyCandidate(c, existing) {
  const name = c.name || "";
  const site = c.website || "";
  const host = hostOf(site);
  if (existing.placeIds.has(c.place_id)) return { verdict: "skip", reason: "already_prospect" };
  const npKey = normName(name) + "|" + normPhone(c.phone);
  if (normPhone(c.phone) && existing.namePhones.has(npKey)) return { verdict: "reject", reason: "duplicate_name_phone" };
  if (LEADGEN_PATTERNS.some((p) => p.test(name)) || LEADGEN_PATTERNS.some((p) => p.test(host))) {
    return { verdict: "reject", reason: "leadgen_or_directory" };
  }
  if (CHAIN_PATTERNS.some((p) => p.test(name)) || CHAIN_DOMAINS.some((d) => host === d || host.endsWith("." + d))) {
    return { verdict: "reject", reason: "national_chain_or_franchise" };
  }
  if (FACILITY_PATTERNS.some((p) => p.test(name))) {
    return { verdict: "reject", reason: "disposal_facility_or_government" };
  }
  if (!RELEVANT_PATTERNS[c.vertical || "dumpster"].test(name + " " + host)) {
    return { verdict: "reject", reason: "not_relevant_to_vertical" };
  }
  if (c.businessStatus && c.businessStatus !== "OPERATIONAL") {
    return { verdict: "reject", reason: "not_operational" };
  }
  const zone = detectZone(c.address);
  if (!zone) return { verdict: "reject", reason: "outside_service_area" };
  return { verdict: "pass", zone };
}

// ── Website email scraping (no paid APIs) ────────────────────────────────────
var EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
var ROLE_PREFIXES = ["info", "office", "contact", "sales", "hello", "service", "admin", "support", "dispatch", "quotes"];
var JUNK_EMAIL_RE = /(example\.com|sentry|wixpress|godaddy|\.png$|\.jpe?g$|\.webp$|\.gif$|\.svg$|@[0-9.]+$|no-?reply|donotreply)/i;
async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
      headers: { "User-Agent": "FlorenceSCServices/1.0 (+https://florencescservices.com)", "Accept": "text/html,*/*" }
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") || "";
    if (!/text|html|xml/.test(ct)) return "";
    return (await res.text()).slice(0, 400000);
  } catch {
    return "";
  }
}
function extractEmails(html) {
  const found = new Set();
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) found.add(decodeURIComponent(m[1]).trim().toLowerCase());
  for (const m of html.matchAll(EMAIL_RE)) found.add(m[0].trim().toLowerCase());
  return [...found].filter((e) => e.includes("@") && !JUNK_EMAIL_RE.test(e) && e.length < 80);
}
function contactLinks(html, baseUrl) {
  const links = new Set();
  const baseHost = hostOf(baseUrl);
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const href = m[1];
    if (!/contact|about|quote|estimate/i.test(href)) continue;
    try {
      const u = new URL(href, baseUrl);
      if (hostOf(u.toString()) === baseHost && /^https?:$/.test(u.protocol)) links.add(u.toString());
    } catch {}
    if (links.size >= 2) break;
  }
  return [...links];
}
function rankEmails(emails, siteHost) {
  return [...emails].sort((a, b) => {
    const score = (e) => {
      const [local, domain] = e.split("@");
      let s = 0;
      if (ROLE_PREFIXES.some((r) => local === r || local.startsWith(r + "."))) s -= 2;
      if (siteHost && (domain === siteHost || siteHost.endsWith("." + domain) || domain.endsWith("." + siteHost))) s -= 3;
      if (/gmail|yahoo|outlook|hotmail|aol|icloud/.test(domain)) s += 1;
      return s;
    };
    return score(a) - score(b);
  });
}
async function scrapeEmails(website) {
  if (!website) return { best: null, candidates: [], pages: 0 };
  let url = website;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const siteHost = hostOf(url);
  const home = await fetchPage(url);
  let all = extractEmails(home);
  let pages = home ? 1 : 0;
  if (home) {
    const linked = contactLinks(home, url);
    const guesses = linked.length ? linked : [new URL("/contact", url).toString()];
    for (const link of guesses.slice(0, 2)) {
      const page = await fetchPage(link);
      if (page) {
        pages++;
        all = all.concat(extractEmails(page));
      }
    }
  }
  const unique = [...new Set(all)];
  const ranked = rankEmails(unique, siteHost);
  return { best: ranked[0] || null, candidates: ranked, pages };
}
// D1-first, then scrape — the rule the whole system follows.
async function findEmailFor(env, { prospect_id, website, name }) {
  if (prospect_id) {
    await ensureSchema(env.DB);
    const p = await env.DB.prepare("SELECT id, email, website, name FROM prospects WHERE id = ?").bind(prospect_id).first();
    if (p && p.email) return { email: p.email, source: "d1", candidates: [p.email] };
    if (p && !website) website = p.website;
    if (p && !name) name = p.name;
  }
  const scraped = await scrapeEmails(website);
  return { email: scraped.best, source: scraped.best ? "website_scrape" : "none", candidates: scraped.candidates, pages_scraped: scraped.pages };
}

// ── Zone exclusivity ─────────────────────────────────────────────────────────
async function zoneOpenFor(env, zone, vertical) {
  if (!zone) return false;
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM prospects WHERE operator_status IN ('active', 'pilot_active') AND default_zone = ? AND COALESCE(vertical, 'dumpster') = ?"
  ).bind(String(zone), vertical === "hauling" ? "hauling" : "dumpster").first();
  return (row?.c || 0) === 0;
}

// ── Pipeline orchestration ──────────────────────────────────────────────────
// All phases run inline in one invocation (the account is on the Workers paid
// plan — the subrequest/CPU budget is ample, and a worker cannot fetch its own
// public hostname, so HTTP self-chaining is off the table). Process drains the
// queue in small batches with a hard cap as a runaway guard.
async function runFull(env, ctx, runId, dry) {
  const out = {};
  out.discover = await runDiscover(env, ctx, runId, dry);
  out.process = await runProcess(env, ctx, runId, dry);
  out.send = await runSend(env, ctx, runId, dry);
  out.digest = await runDigest(env, ctx, runId, dry);
  return out;
}

// ── Phase: discover ──────────────────────────────────────────────────────────
async function runDiscover(env, ctx, runId, dry) {
  const toggle = await getToggle(env);
  const paused = toggle.paused || env.OUTREACH_PAUSED === "true" || !!dry;
  await logRow(env, { run_id: runId, event: "run_started", detail: { paused, dry: !!dry, toggle_reason: toggle.reason || null, version: VERSION } });
  const { key, source: keySource } = await getPlacesKey(env);
  if (!key) {
    await logRow(env, { run_id: runId, event: "error", detail: { where: "discover", error: "no GOOGLE_PLACES_API_KEY (env or d1 config) — discovery skipped" } });
    return { discovered: 0, queued: 0, rejected: 0, skipped: "no_places_key" };
  }
  await ensureSchema(env.DB);
  const { results: prospects } = await env.DB.prepare("SELECT place_id, name, phone FROM prospects").all();
  const { results: queueRows } = await env.DB.prepare("SELECT place_id FROM outreach_queue").all();
  const existing = {
    placeIds: new Set([...(prospects || []).map((p) => p.place_id).filter(Boolean), ...(queueRows || []).map((q) => q.place_id)]),
    namePhones: new Set((prospects || []).map((p) => normName(p.name) + "|" + normPhone(p.phone)))
  };
  const candidates = new Map();
  let queryErrors = 0;
  for (const [vKey, V] of Object.entries(VERTICALS)) {
    for (const q of V.queries) {
      try {
        const places = await placesSearch(key, `${q} near Florence SC`);
        for (const pl of places) {
          if (!pl.id || candidates.has(pl.id)) continue;
          candidates.set(pl.id, {
            place_id: pl.id,
            name: pl.displayName?.text || "",
            address: pl.formattedAddress || "",
            phone: pl.nationalPhoneNumber || "",
            website: pl.websiteUri || "",
            rating: pl.rating || 0,
            reviews: pl.userRatingCount || 0,
            businessStatus: pl.businessStatus || null,
            vertical: vKey
          });
        }
      } catch (e) {
        queryErrors++;
        await logRow(env, { run_id: runId, event: "error", detail: { where: "places_search", query: q, vertical: vKey, error: e.message } });
      }
    }
  }
  let queued = 0, rejected = 0, skipped = 0;
  for (const c of candidates.values()) {
    const cls = classifyCandidate(c, existing);
    if (cls.verdict === "skip") { skipped++; continue; }
    if (cls.verdict === "reject") {
      rejected++;
      await logRow(env, { run_id: runId, event: "rejected", place_id: c.place_id, name: c.name, zone: detectZone(c.address), detail: { reason: cls.reason, website: c.website || null, address: c.address } });
      // Remember rejects in the queue too so we never re-log them daily.
      await env.DB.prepare("INSERT OR IGNORE INTO outreach_queue (place_id, payload, status, processed_at, note) VALUES (?, ?, 'rejected', datetime('now'), ?)")
        .bind(c.place_id, JSON.stringify(c), cls.reason).run();
      continue;
    }
    c.zone = cls.zone;
    queued++;
    await env.DB.prepare("INSERT OR IGNORE INTO outreach_queue (place_id, payload, status) VALUES (?, ?, 'pending')")
      .bind(c.place_id, JSON.stringify(c)).run();
    await logRow(env, { run_id: runId, event: "discovered", place_id: c.place_id, name: c.name, zone: c.zone, detail: { vertical: c.vertical, phone: c.phone || null, website: c.website || null, rating: c.rating, reviews: c.reviews } });
  }
  await logRow(env, { run_id: runId, event: "discover_done", detail: { found: candidates.size, queued, rejected, already_known: skipped, query_errors: queryErrors, key_source: keySource } });
  return { found: candidates.size, queued, rejected, skipped };
}

// ── Phase: process (email-find → add → enroll; drains the queue) ────────────
async function runProcess(env, ctx, runId, dry) {
  await ensureSchema(env.DB);
  let added = 0, enrolled = 0, rejected = 0, processed = 0;
  // Batched drain with a hard cap: worst case ~14 batches × 6 candidates ×
  // ~6 fetches ≈ 500 subrequests, inside the paid-plan budget.
  for (let batch = 0; batch < 14; batch++) {
    const { results: rows } = await env.DB.prepare("SELECT place_id, payload FROM outreach_queue WHERE status = 'pending' LIMIT ?").bind(PROCESS_BATCH).all();
    if (!rows || rows.length === 0) break;
    const r = await processBatch(env, runId, rows);
    added += r.added; enrolled += r.enrolled; rejected += r.rejected; processed += rows.length;
  }
  const { results: left } = await env.DB.prepare("SELECT COUNT(*) AS c FROM outreach_queue WHERE status = 'pending'").all();
  const remaining = left?.[0]?.c || 0;
  if (remaining > 0) {
    await logRow(env, { run_id: runId, event: "process_deferred", detail: { remaining, note: "batch cap hit — remaining candidates process next run" } });
  }
  await logRow(env, { run_id: runId, event: "process_done", detail: { processed, added, enrolled, rejected, remaining } });
  return { processed, added, enrolled, rejected, remaining };
}
async function processBatch(env, runId, rows) {
  let added = 0, enrolled = 0, rejected = 0;
  for (const row of rows) {
    let c;
    try { c = JSON.parse(row.payload); } catch {
      await env.DB.prepare("UPDATE outreach_queue SET status = 'error', processed_at = datetime('now'), note = 'bad payload' WHERE place_id = ?").bind(row.place_id).run();
      continue;
    }
    try {
      // Email discovery: D1 has nothing for brand-new candidates, so this is
      // effectively "scrape their website" (homepage + contact page).
      const found = await scrapeEmails(c.website);
      const email = found.best;
      if (!c.phone && !email) {
        rejected++;
        await logRow(env, { run_id: runId, event: "rejected", place_id: c.place_id, name: c.name, zone: c.zone, detail: { reason: "uncontactable_no_phone_no_email", website: c.website || null, pages_scraped: found.pages } });
        await env.DB.prepare("UPDATE outreach_queue SET status = 'rejected', processed_at = datetime('now'), note = 'uncontactable' WHERE place_id = ?").bind(row.place_id).run();
        continue;
      }
      // Add to CRM (hub owns prospect business logic + activity history).
      let prospectId = null;
      try {
        const created = await crmAPI(env, "/prospects", "POST", {
          place_id: c.place_id,
          name: c.name,
          short_name: c.name.replace(/\b(llc|inc\.?|co\.?|corp\.?)\b/gi, "").trim(),
          phone: c.phone || "",
          address: c.address || "",
          website: c.website || null,
          email: email || null,
          rating: c.rating || 0,
          reviews: c.reviews || 0,
          vertical: c.vertical,
          notes: `Auto-added by outreach engine (${runId}). Zone ${c.zone} — ${ZONE_NAMES[c.zone] || "?"}.`
        });
        prospectId = created.id || c.place_id;
      } catch (e) {
        if (e.status === 409) {
          await env.DB.prepare("UPDATE outreach_queue SET status = 'done', processed_at = datetime('now'), note = 'already existed' WHERE place_id = ?").bind(row.place_id).run();
          await logRow(env, { run_id: runId, event: "skipped", place_id: c.place_id, name: c.name, detail: { reason: "already_prospect_409" } });
          continue;
        }
        throw e;
      }
      added++;
      await crmAPI(env, `/prospects/${encodeURIComponent(prospectId)}`, "PATCH", { default_zone: c.zone });
      await logRow(env, { run_id: runId, event: "added", prospect_id: prospectId, place_id: c.place_id, name: c.name, email: email || null, zone: c.zone, detail: { vertical: c.vertical, email_source: email ? "website_scrape" : null, pages_scraped: found.pages, phone: c.phone || null } });
      // Enroll — only with an email, an open zone (per vertical), no suppression.
      let enrollBlock = null;
      if (!email) enrollBlock = "no_email";
      else if (await isSuppressed(env, email)) enrollBlock = "suppressed";
      else if (!(await zoneOpenFor(env, c.zone, c.vertical))) enrollBlock = "zone_occupied";
      if (!enrollBlock) {
        const seq = VERTICALS[c.vertical]?.sequence || "new_prospect";
        await crmAPI(env, `/prospects/${encodeURIComponent(prospectId)}/enroll`, "POST", { sequence: seq });
        enrolled++;
        await logRow(env, { run_id: runId, event: "enrolled", prospect_id: prospectId, name: c.name, email, zone: c.zone, detail: { sequence: seq } });
      } else {
        await logRow(env, { run_id: runId, event: "added_not_enrolled", prospect_id: prospectId, name: c.name, email: email || null, zone: c.zone, detail: { reason: enrollBlock } });
      }
      await env.DB.prepare("UPDATE outreach_queue SET status = 'done', processed_at = datetime('now') WHERE place_id = ?").bind(row.place_id).run();
    } catch (e) {
      await logRow(env, { run_id: runId, event: "error", place_id: row.place_id, name: c?.name, detail: { where: "process", error: e.message } });
      await env.DB.prepare("UPDATE outreach_queue SET status = 'error', processed_at = datetime('now'), note = ? WHERE place_id = ?").bind(String(e.message).slice(0, 200), row.place_id).run();
    }
  }
  return { added, enrolled, rejected };
}

// ── Phase: send due sequence steps ───────────────────────────────────────────
async function runSend(env, ctx, runId, dry) {
  const toggle = await getToggle(env);
  const paused = toggle.paused || env.OUTREACH_PAUSED === "true" || !!dry;
  let due = [];
  try {
    const r = await crmAPI(env, "/due-actions");
    due = r.due || [];
  } catch (e) {
    await logRow(env, { run_id: runId, event: "error", detail: { where: "due-actions", error: e.message } });
  }
  if (paused) {
    await logRow(env, { run_id: runId, event: "sends_skipped", detail: { reason: env.OUTREACH_PAUSED === "true" ? "env_paused" : dry ? "dry_run" : "toggle_paused", due_count: due.length, would_send: due.filter((p) => p.email && p.sequence).slice(0, 20).map((p) => ({ name: p.short_name || p.name, step: p.sequence_step })) } });
    return { paused: true, due: due.length };
  }
  let sent = 0, failed = 0, skipped = 0;
  for (const p of due) {
    if (sent >= MAX_EMAILS_PER_RUN) {
      await logRow(env, { run_id: runId, event: "cap_reached", detail: { cap: MAX_EMAILS_PER_RUN, remaining_due: due.length - sent } });
      break;
    }
    if (!p.sequence) continue;
    const seq = SEQUENCES[p.sequence];
    if (!seq) { skipped++; continue; }
    const stepIndex = p.sequence_step || 0;
    if (stepIndex >= seq.steps.length) continue;
    const step = seq.steps[stepIndex];
    const enrolledDate = new Date(p.sequence_started || p.created_at || Date.now());
    const now = new Date();
    const startDay = new Date(enrolledDate.getFullYear(), enrolledDate.getMonth(), enrolledDate.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysSinceEnroll = Math.round((today - startDay) / 86400000);
    if (daysSinceEnroll < step.day) continue;
    if (!p.email) {
      skipped++;
      await crmAPI(env, "/outreach-state", "POST", { prospect_id: p.id, step: stepIndex, status: "skipped", type: "email", reason: "no email address" }).catch(() => {});
      await logRow(env, { run_id: runId, event: "skipped", prospect_id: p.id, name: p.short_name || p.name, detail: { reason: "no_email", step: stepIndex } });
      continue;
    }
    if (await isSuppressed(env, p.email)) {
      skipped++;
      await crmAPI(env, `/prospects/${encodeURIComponent(p.id)}/unenroll`, "POST").catch(() => {});
      await logRow(env, { run_id: runId, event: "skipped", prospect_id: p.id, name: p.short_name || p.name, email: p.email, detail: { reason: "suppressed_unenrolled", step: stepIndex } });
      continue;
    }
    const { subject, body } = generateEmailContent(env, p, stepIndex);
    const r = await sendOutreachEmail(env, p, subject, body);
    if (r.ok) {
      // Advance state ONLY on a confirmed 2xx from Resend.
      sent++;
      try {
        await crmAPI(env, "/outreach-state", "POST", { prospect_id: p.id, step: stepIndex, status: "sent", type: "email", recipient: p.email });
        await crmAPI(env, `/prospects/${encodeURIComponent(p.id)}/advance`, "POST", { note: `✅ Auto-sent: ${step.label} to ${p.email}` });
        await crmAPI(env, `/prospects/${encodeURIComponent(p.id)}/activities`, "POST", { type: "email", note: `Auto-sent: ${step.label}`, draft_subject: subject, draft_body: body });
      } catch (e) {
        await logRow(env, { run_id: runId, event: "error", prospect_id: p.id, detail: { where: "post_send_state", error: e.message } });
      }
      await logRow(env, { run_id: runId, event: "email_sent", prospect_id: p.id, name: p.short_name || p.name, email: p.email, zone: p.default_zone, detail: { step: stepIndex, label: step.label, subject, resend_id: r.id, status: r.status } });
      await new Promise((res) => setTimeout(res, SEND_DELAY_MS));
    } else {
      failed++;
      // Leave sequence state untouched so it retries next run.
      await crmAPI(env, "/outreach-state", "POST", { prospect_id: p.id, step: stepIndex, status: "failed", type: "email", reason: r.error }).catch(() => {});
      await logRow(env, { run_id: runId, event: "email_failed", prospect_id: p.id, name: p.short_name || p.name, email: p.email, detail: { step: stepIndex, error: r.error, status: r.status } });
    }
  }
  await logRow(env, { run_id: runId, event: "send_done", detail: { sent, failed, skipped, due: due.length } });
  return { sent, failed, skipped, due: due.length };
}

// ── Phase: daily digest to Charlie ───────────────────────────────────────────
async function runDigest(env, ctx, runId, dry) {
  await ensureSchema(env.DB);
  const day = new Date().toISOString().slice(0, 10);
  const { results: byEvent } = await env.DB.prepare("SELECT event, COUNT(*) AS c FROM outreach_log WHERE date(ts) = ? GROUP BY event").bind(day).all();
  const counts = {};
  for (const r of byEvent || []) counts[r.event] = r.c;
  const { results: reasons } = await env.DB.prepare("SELECT COALESCE(json_extract(detail,'$.reason'),'unspecified') AS reason, COUNT(*) AS c FROM outreach_log WHERE date(ts) = ? AND event = 'rejected' GROUP BY reason ORDER BY c DESC").bind(day).all();
  const { results: sentRows } = await env.DB.prepare("SELECT name, email, zone, detail FROM outreach_log WHERE date(ts) = ? AND event = 'email_sent' ORDER BY id").bind(day).all();
  const { results: failRows } = await env.DB.prepare("SELECT name, email, detail FROM outreach_log WHERE date(ts) = ? AND event IN ('email_failed','error') ORDER BY id DESC LIMIT 15").bind(day).all();
  const { results: addedRows } = await env.DB.prepare("SELECT name, email, zone, detail FROM outreach_log WHERE date(ts) = ? AND event = 'added' ORDER BY id").bind(day).all();
  const { results: unsubs } = await env.DB.prepare("SELECT email FROM outreach_log WHERE date(ts) = ? AND event = 'unsubscribed'").bind(day).all();
  const { results: ops } = await env.DB.prepare("SELECT name, default_zone, vertical FROM prospects WHERE operator_status IN ('active','pilot_active') AND default_zone IS NOT NULL").all();
  const toggle = await getToggle(env);
  const paused = toggle.paused || env.OUTREACH_PAUSED === "true" || !!dry;

  const occupied = new Set((ops || []).map((o) => String(o.default_zone) + "/" + (o.vertical || "dumpster")));
  const zoneLines = Object.entries(ZONE_NAMES).map(([z, n]) => {
    const d = occupied.has(z + "/dumpster") ? "taken" : "OPEN";
    const h = occupied.has(z + "/hauling") ? "taken" : "OPEN";
    return `  Zone ${z} ${n}: dumpster ${d} / hauling ${h}`;
  });
  const lines = [
    `FSC outreach digest — ${day}${paused ? " — ⏸ PAUSED (no cold emails were sent)" : ""}`,
    ``,
    `Discovered: ${counts.discovered || 0} new candidates · Added to CRM: ${counts.added || 0} · Enrolled: ${counts.enrolled || 0}`,
    `Emails sent: ${counts.email_sent || 0} · Failed: ${counts.email_failed || 0} · Rejected: ${counts.rejected || 0} · Unsubscribed: ${(unsubs || []).length}`,
    ``
  ];
  if ((addedRows || []).length) {
    lines.push(`Added:`);
    for (const a of addedRows) lines.push(`  • ${a.name}${a.email ? ` <${a.email}>` : " (no email found)"} — zone ${a.zone || "?"}`);
    lines.push("");
  }
  if ((sentRows || []).length) {
    lines.push(`Sent:`);
    for (const s of sentRows) {
      let d = {};
      try { d = JSON.parse(s.detail || "{}"); } catch {}
      lines.push(`  • step ${d.step ?? "?"} → ${s.name} <${s.email}> ("${d.subject || ""}")`);
    }
    lines.push("");
  }
  if (paused && counts.sends_skipped) {
    lines.push(`Paused: due sequence steps were held. Unpause from the dashboard (Outreach → Automation) or POST /outreach-toggle {"paused":false}.`);
    lines.push("");
  }
  if ((reasons || []).length) {
    lines.push(`Rejections:`);
    for (const r of reasons) lines.push(`  • ${r.reason}: ${r.c}`);
    lines.push("");
  }
  if ((failRows || []).length) {
    lines.push(`Errors / failures (latest ${failRows.length}):`);
    for (const f of failRows) {
      let d = {};
      try { d = JSON.parse(f.detail || "{}"); } catch {}
      lines.push(`  • ${f.name || d.where || "engine"}: ${d.error || d.reason || "?"}`);
    }
    lines.push("");
  }
  lines.push(`Zones:`);
  lines.push(...zoneLines);
  lines.push("");
  lines.push(`Kill switch: ${paused ? "PAUSED" : "live"}${toggle.reason ? ` (${toggle.reason})` : ""}`);
  lines.push(`Run: ${runId} · engine v${VERSION} · log: dashboard → Outreach Engine → Automation`);

  const subject = `FSC outreach — ${counts.added || 0} added, ${counts.email_sent || 0} emailed, ${counts.rejected || 0} rejected${paused ? " [paused]" : ""} (${day})`;
  const r = await sendEmailResend(env, { to: env.DIGEST_TO || DIGEST_TO, subject, text: lines.join("\n") });
  await logRow(env, { run_id: runId, event: r.ok ? "digest_sent" : "digest_failed", email: env.DIGEST_TO || DIGEST_TO, detail: { resend_id: r.id || null, status: r.status, error: r.error || null } });
  await logRow(env, { run_id: runId, event: "run_finished", detail: { day } });
  return { digest: r.ok, resend_id: r.id || null, error: r.error || null };
}

async function runPhase(env, ctx, phase, runId, dry) {
  switch (phase) {
    case "full": return runFull(env, ctx, runId, dry);
    case "discover": return runDiscover(env, ctx, runId, dry);
    case "process": return runProcess(env, ctx, runId, dry);
    case "send": return runSend(env, ctx, runId, dry);
    case "digest": return runDigest(env, ctx, runId, dry);
    default: throw new Error(`unknown phase ${phase}`);
  }
}

// ── Mailer: RPC entrypoint for sibling workers (service bindings) ───────────
// florence-lead-followup and florence-crm-api send through this so the Resend
// key lives on exactly one worker. Public HTTP cannot invoke RPC methods.
export class Mailer extends WorkerEntrypoint {
  async send({ to, subject, text, html, from, kind = "transactional", headers } = {}) {
    const env = this.env;
    if (!to || !subject || (!text && !html)) return { ok: false, status: 0, error: "missing to/subject/body" };
    if (kind !== "owner_alert" && kind !== "digest") {
      if (await isSuppressed(env, to)) {
        await logRow(env, { source: "mailer", event: "email_suppressed", email: to, detail: { kind, subject } });
        return { ok: false, status: 0, error: "suppressed", suppressed: true };
      }
    }
    const r = await sendEmailResend(env, { to, subject, text, html, from, headers });
    await logRow(env, { source: "mailer", event: r.ok ? "email_sent" : "email_failed", email: to, detail: { kind, subject, resend_id: r.id || null, status: r.status, error: r.error || null } });
    return r;
  }
}

// ── HTTP + cron ──────────────────────────────────────────────────────────────
export default {
  async scheduled(event, env, ctx) {
    const runId = newRunId();
    console.log(`cron ${event.cron} → run ${runId}`);
    const result = await runFull(env, ctx, runId, false);
    console.log(`run ${runId} finished:`, JSON.stringify(result));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
    }

    // ---- public: unsubscribe (one-click, signed) ----
    if (path === "/unsubscribe") {
      const id = url.searchParams.get("id");
      const t = url.searchParams.get("t") || "";
      if (id && id !== "PREVIEW" && id !== "TEST") {
        const expected = env.UNSUB_SECRET ? await hmac(String(id), env.UNSUB_SECRET) : t;
        if (t === expected) {
          try {
            await ensureSchema(env.DB);
            const p = await env.DB.prepare("SELECT id, email, name FROM prospects WHERE id = ?").bind(id).first();
            if (p?.email) await suppress(env, p.email, "unsubscribed", id);
            await crmAPI(env, `/prospects/${encodeURIComponent(id)}/unenroll`, "POST").catch(async () => {
              await env.DB.prepare("UPDATE prospects SET sequence = NULL, sequence_step = 0, sequence_started = NULL, updated_at = datetime('now') WHERE id = ?").bind(id).run();
            });
            await logRow(env, { event: "unsubscribed", prospect_id: id, email: p?.email || null, name: p?.name || null, detail: { via: request.method } });
          } catch (e) {
            console.log(`unsubscribe error for ${id}: ${e.message}`);
          }
        } else {
          console.log(`unsubscribe token mismatch for ${id}`);
        }
      }
      if (request.method === "POST") return new Response("Unsubscribed", { status: 200 });
      return new Response(
        `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;text-align:center"><h1>You're unsubscribed</h1><p>You won't receive any more emails from Florence SC Services.</p></body>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // ---- public: preflight (booleans only, no secrets) ----
    if (path === "/preflight" && request.method === "GET") {
      const out = { version: VERSION, now: new Date().toISOString() };
      try {
        await ensureSchema(env.DB);
        out.d1_ok = true;
        const sup = await env.DB.prepare("SELECT COUNT(*) AS c FROM suppression").first();
        out.suppression_count = sup?.c ?? 0;
        const q = await env.DB.prepare("SELECT status, COUNT(*) AS c FROM outreach_queue GROUP BY status").all();
        out.queue = Object.fromEntries((q.results || []).map((r) => [r.status, r.c]));
        const last = await env.DB.prepare("SELECT run_id, MAX(ts) AS ts FROM outreach_log WHERE run_id IS NOT NULL GROUP BY run_id ORDER BY ts DESC LIMIT 1").first();
        out.last_run = last || null;
        const toggle = await getToggle(env);
        out.paused = { toggle: !!toggle.paused, env: env.OUTREACH_PAUSED === "true", reason: toggle.reason || null };
      } catch (e) {
        out.d1_ok = false;
        out.d1_error = e.message;
      }
      out.resend_key_present = !!env.RESEND_API_KEY;
      out.places_key = (await getPlacesKey(env)).source;
      try {
        const res = await fetch(`${env.CRM_API_URL || CRM_API_URL_DEFAULT}/auth/check`, { headers: { Authorization: `Bearer ${env.CRM_API_TOKEN || ""}` } });
        out.crm_api = res.ok ? "ok" : res.status === 401 ? "unauthorized" : `error_${res.status}`;
      } catch (e) {
        out.crm_api = "unreachable";
      }
      out.ok = !!(out.d1_ok && out.resend_key_present && out.crm_api === "ok");
      return json(out, out.ok ? 200 : 503);
    }

    // ---- everything else below requires auth ----
    const authed = isAuthed(request, url, env);
    const need = () => json({ error: "unauthorized" }, 401);

    if (path === "/trigger" && request.method === "POST") {
      if (!authed) return need();
      const phase = url.searchParams.get("phase") || "full";
      const runId = url.searchParams.get("run") || newRunId();
      const dry = url.searchParams.get("dry") === "1";
      if (phase === "full" || phase === "discover") {
        // Full pipeline runs in the background — can take minutes when the
        // queue is deep (website scraping). Watch /outreach-log for progress.
        ctx.waitUntil(runFull(env, ctx, runId, dry).then(
          (r) => console.log(`run ${runId} finished:`, JSON.stringify(r)),
          (e) => logRow(env, { run_id: runId, event: "error", detail: { where: "runFull", error: e.message } })
        ));
        return json({ ok: true, run_id: runId, started: "full", dry, note: "pipeline running in background; watch /outreach-log" });
      }
      const result = await runPhase(env, ctx, phase, runId, dry);
      return json({ ok: true, run_id: runId, phase, result });
    }

    if (path === "/test-email" && request.method === "POST") {
      if (!authed) return need();
      const unsubscribeUrl = await unsubscribeUrlFor(env, "TEST");
      const r = await sendEmailResend(env, {
        to: DIGEST_TO,
        subject: "Resend production test — Florence SC Services outreach engine",
        text: `This was sent from the rebuilt outreach engine (v${VERSION}) through Resend using the production sender.\n\nThe footer below is exactly what every outreach email carries (postal address + one-click unsubscribe).\n— Charlie` + emailFooter(unsubscribeUrl)
      });
      await logRow(env, { event: r.ok ? "email_sent" : "email_failed", source: "test", email: DIGEST_TO, detail: { kind: "test", resend_id: r.id || null, status: r.status, error: r.error || null } });
      return json({ success: r.ok, result: r }, r.ok ? 200 : 502);
    }

    if (path === "/preview" && request.method === "GET") {
      if (!authed) return need();
      const vertical = url.searchParams.get("vertical") === "hauling" ? "hauling" : "dumpster";
      const sample = {
        id: "PREVIEW",
        name: url.searchParams.get("company") || (vertical === "hauling" ? "Pee Dee Junk Removal" : "Ace Roll-Off Dumpsters"),
        short_name: url.searchParams.get("company") || (vertical === "hauling" ? "Pee Dee Junk Removal" : "Ace Roll-Off"),
        contact_name: url.searchParams.get("contact") || "Dave",
        vertical,
        default_zone: url.searchParams.get("zone") || "4"
      };
      const seqKey = VERTICALS[vertical].sequence;
      const steps = SEQUENCES[seqKey].steps;
      const previews = [];
      for (let i = 0; i < steps.length; i++) {
        const { subject, body } = generateEmailContent(env, sample, i);
        previews.push({ step: i, day: steps[i].day, label: steps[i].label, subject, body: body + emailFooter(await unsubscribeUrlFor(env, "PREVIEW")) });
      }
      return json({ sample, sequence: seqKey, previews });
    }

    if (path === "/status" && request.method === "GET") {
      if (!authed) return need();
      await ensureSchema(env.DB);
      const toggle = await getToggle(env);
      const { results: lastRuns } = await env.DB.prepare("SELECT run_id, MIN(ts) AS started, MAX(ts) AS ended, COUNT(*) AS row_count FROM outreach_log WHERE run_id IS NOT NULL GROUP BY run_id ORDER BY started DESC LIMIT 5").all();
      const { results: todayEvents } = await env.DB.prepare("SELECT event, COUNT(*) AS c FROM outreach_log WHERE date(ts) = date('now') GROUP BY event").all();
      const { results: queue } = await env.DB.prepare("SELECT status, COUNT(*) AS c FROM outreach_queue GROUP BY status").all();
      const { results: enrolledRows } = await env.DB.prepare("SELECT COALESCE(vertical,'dumpster') AS vertical, COUNT(*) AS c FROM prospects WHERE sequence IS NOT NULL GROUP BY 1").all();
      const { results: ops } = await env.DB.prepare("SELECT name, default_zone, vertical, operator_status FROM prospects WHERE operator_status IN ('active','pilot_active')").all();
      let due = null;
      try { due = (await crmAPI(env, "/due-actions")).count; } catch {}
      const sup = await env.DB.prepare("SELECT COUNT(*) AS c FROM suppression").first();
      return json({
        version: VERSION,
        paused: { toggle: !!toggle.paused, env: env.OUTREACH_PAUSED === "true", reason: toggle.reason || null, updated_at: toggle.updated_at || null },
        due_now: due,
        today: Object.fromEntries((todayEvents || []).map((r) => [r.event, r.c])),
        recent_runs: lastRuns || [],
        queue: Object.fromEntries((queue || []).map((r) => [r.status, r.c])),
        enrolled: Object.fromEntries((enrolledRows || []).map((r) => [r.vertical, r.c])),
        active_operators: ops || [],
        suppression_count: sup?.c ?? 0,
        zone_names: ZONE_NAMES
      });
    }

    if (path === "/outreach-log" && request.method === "GET") {
      if (!authed) return need();
      await ensureSchema(env.DB);
      const event = url.searchParams.get("event");
      const day = url.searchParams.get("day");
      const runId = url.searchParams.get("run_id");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
      const conds = [], vals = [];
      if (event) { conds.push("event = ?"); vals.push(event); }
      if (day) { conds.push("date(ts) = ?"); vals.push(day); }
      if (runId) { conds.push("run_id = ?"); vals.push(runId); }
      let sql = "SELECT * FROM outreach_log" + (conds.length ? " WHERE " + conds.join(" AND ") : "") + " ORDER BY id DESC LIMIT ?";
      vals.push(limit);
      const { results } = await env.DB.prepare(sql).bind(...vals).all();
      return json({ log: results || [], count: (results || []).length });
    }

    if (path === "/toggle" && request.method === "GET") {
      if (!authed) return need();
      const t = await getToggle(env);
      return json({ ...t, env_paused: env.OUTREACH_PAUSED === "true" });
    }
    if (path === "/toggle" && request.method === "POST") {
      if (!authed) return need();
      const body = await request.json().catch(() => ({}));
      const t = await setToggle(env, body.paused === true || body.paused === "true", body.reason, body.actor || "api");
      return json({ success: true, ...t, env_paused: env.OUTREACH_PAUSED === "true" });
    }

    if (path === "/email-search" && request.method === "POST") {
      if (!authed) return need();
      const body = await request.json().catch(() => ({}));
      const found = await findEmailFor(env, { prospect_id: body.prospect_id || null, website: body.website || null, name: body.name || null });
      if (body.prospect_id && found.email && found.source !== "d1" && body.save !== false) {
        try {
          await crmAPI(env, `/prospects/${encodeURIComponent(body.prospect_id)}`, "PATCH", { email: found.email });
          await logRow(env, { event: "email_found", prospect_id: body.prospect_id, email: found.email, detail: { source: found.source } });
        } catch (e) {
          await logRow(env, { event: "error", prospect_id: body.prospect_id, detail: { where: "email-search save", error: e.message } });
        }
      }
      // Both response shapes: new ({email, source, candidates}) and the legacy
      // one the dashboard's findEmail() already parses ({emails: [...]}).
      return json({
        email: found.email,
        source: found.source,
        candidates: found.candidates,
        pages_scraped: found.pages_scraped || 0,
        emails: (found.candidates || []).map((e) => ({ email: e, sources: [found.source] }))
      });
    }

    if (path === "/stop" && request.method === "POST") {
      if (!authed) return need();
      const { prospect_id } = await request.json().catch(() => ({}));
      if (!prospect_id) return json({ error: "prospect_id required" }, 400);
      await crmAPI(env, `/prospects/${encodeURIComponent(prospect_id)}/unenroll`, "POST");
      await logRow(env, { event: "stopped", prospect_id, detail: { via: "api" } });
      return json({ success: true, stopped: prospect_id });
    }

    return json({
      service: `Florence SC Services — Outreach Engine v${VERSION}`,
      endpoints: {
        "GET  /preflight": "public health/readiness booleans (no secrets)",
        "GET|POST /unsubscribe": "one-click opt-out (public, signed link) — adds to permanent suppression",
        "POST /trigger": "run the pipeline now (?phase=discover|process|send|digest, ?dry=1) — auth",
        "GET  /preview": "render all 5 sequence emails without sending (?vertical=&company=&contact=&zone=) — auth",
        "POST /test-email": "production-path test email to Charlie — auth",
        "GET  /status": "engine status: toggle, due, runs, queue, operators — auth",
        "GET  /outreach-log": "audit trail (?event=&day=&run_id=&limit=) — auth",
        "GET|POST /toggle": "kill switch (D1-backed; POST {paused, reason}) — auth",
        "POST /email-search": "find an operator email: D1 first, then website scrape {prospect_id|website} — auth",
        "POST /stop": "unenroll a prospect {prospect_id} — auth"
      },
      auth: "Bearer CRM_API_TOKEN (or ADMIN_SECRET / SMOKE_TOKEN)"
    });
  }
};
