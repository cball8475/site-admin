var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var __defProp22 = Object.defineProperty;
var __name22 = /* @__PURE__ */ __name2((target, value) => __defProp22(target, "name", { value, configurable: true }), "__name");
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}
__name(json, "json");
__name2(json, "json");
__name22(json, "json");
function err(msg, status = 400) {
  return json({ error: msg }, status);
}
__name(err, "err");
__name2(err, "err");
__name22(err, "err");
function twiml(msg) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`,
    { status: 200, headers: { "Content-Type": "text/xml" } }
  );
}
__name(twiml, "twiml");
__name2(twiml, "twiml");
__name22(twiml, "twiml");
var SPAM_MIN_DURATION = 38;
var AUTHORIZED_SMS = ["+18437581987", "18437581987", "8437581987"];
function scoreLead(timeline, projectType) {
  const t = (timeline || "").toLowerCase().trim();
  const p = (projectType || "").toLowerCase().trim();
  const hotProjects = ["construction", "demo", "demolition", "roofing", "roof"];
  if (t === "asap" || t === "today" || t === "tomorrow") return "hot";
  if (t === "this week" || t === "this_week") {
    return hotProjects.some((hp) => p.includes(hp)) ? "hot" : "warm";
  }
  if (t === "next week" || t === "next_week") return "warm";
  if (t === "flexible" || t === "no rush" || t === "this month") return "cold";
  return t ? "warm" : "cold";
}
__name(scoreLead, "scoreLead");
__name2(scoreLead, "scoreLead");
__name22(scoreLead, "scoreLead");
function scoreCall(durationSeconds) {
  if (durationSeconds >= 120) return "hot";
  if (durationSeconds >= 30) return "warm";
  return "cold";
}
__name(scoreCall, "scoreCall");
__name2(scoreCall, "scoreCall");
__name22(scoreCall, "scoreCall");
function matchPath(path, pattern) {
  const regex = new RegExp("^" + pattern.replace(/:([^/]+)/g, "([^/]+)") + "$");
  const m = path.match(regex);
  return m ? m.slice(1).map(decodeURIComponent) : null;
}
__name(matchPath, "matchPath");
__name2(matchPath, "matchPath");
__name22(matchPath, "matchPath");
async function logLeadEvent(db, leadId, eventType, eventData, actor) {
  try {
    await db.prepare(
      "INSERT INTO lead_events (lead_id, event_type, event_data, actor) VALUES (?, ?, ?, ?)"
    ).bind(leadId, eventType, eventData ? JSON.stringify(eventData) : null, actor || "system").run();
  } catch (e) {
    console.error("Failed to log lead event:", e);
  }
}
__name(logLeadEvent, "logLeadEvent");
__name2(logLeadEvent, "logLeadEvent");
__name22(logLeadEvent, "logLeadEvent");
function detectZone(cityOrZip) {
  const v = (cityOrZip || "").toLowerCase().trim();
  const zipMap = {
    // Zone 1 — Florence County
    "29501": "1",
    "29502": "1",
    "29503": "1",
    "29504": "1",
    "29505": "1",
    "29506": "1",
    "29161": "1",
    "29555": "1",
    "29580": "1",
    "29583": "1",
    "29541": "1",
    "29560": "1",
    // Zone 2 — Grand Strand / Horry County
    "29526": "2",
    "29527": "2",
    "29566": "2",
    "29568": "2",
    "29569": "2",
    "29572": "2",
    "29575": "2",
    "29576": "2",
    "29577": "2",
    "29578": "2",
    "29579": "2",
    "29582": "2",
    // Zone 3 — Georgetown / Williamsburg
    "29440": "3",
    "29442": "3",
    "29443": "3",
    "29444": "3",
    "29556": "3",
    "29554": "3",
    // Zone 4 — Darlington County
    "29532": "4",
    "29550": "4",
    "29551": "4",
    "29069": "4",
    "29067": "4",
    // Zone 5 — Marion / Dillon Counties
    "29571": "5",
    "29574": "5",
    "29536": "5",
    "29565": "5",
    "29563": "5",
    "29511": "5",
    // Zone 6 — Chesterfield / Marlboro Counties
    "29512": "6",
    "29520": "6",
    "29516": "6",
    "29101": "6",
    "29728": "6",
    "29009": "6",
    "29030": "6",
    // Zone 7 — Sumter / Lee / Clarendon Counties
    "29150": "7",
    "29151": "7",
    "29152": "7",
    "29153": "7",
    "29154": "7",
    "29102": "7",
    "29010": "7",
    "29162": "7",
    "29104": "7",
    "29128": "7"
  };
  const zipMatch = v.match(/\b(\d{5})\b/);
  if (zipMatch && zipMap[zipMatch[1]]) return zipMap[zipMatch[1]];
  const cityMap = {
    "1": ["florence", "effingham", "timmonsville", "johnsonville", "scranton", "coward", "quinby", "pamplico", "lake city"],
    "2": ["myrtle beach", "conway", "surfside", "murrells inlet", "north myrtle", "little river", "longs", "loris", "aynor"],
    "3": ["georgetown", "andrews", "kingstree", "hemingway", "williamsburg"],
    "4": ["darlington", "hartsville", "lamar", "society hill", "dovesville"],
    "5": ["marion", "mullins", "dillon", "latta", "lake view", "nichols"],
    "6": ["bennettsville", "cheraw", "chesterfield", "pageland", "mcbee", "patrick", "jefferson"],
    "7": ["sumter", "manning", "bishopville", "turbeville", "pinewood", "clarendon"]
  };
  for (const [zone, cities] of Object.entries(cityMap)) {
    if (cities.some((c) => v.includes(c))) return zone;
  }
  return null;
}
__name(detectZone, "detectZone");
__name2(detectZone, "detectZone");
__name22(detectZone, "detectZone");
async function sendLeadSMS(env, { name, phone, city, zone, project_type, score, source }, leadId) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    console.warn("Twilio secrets missing \u2014 SMS skipped");
    return { sent: false, reason: "twilio_secrets_missing" };
  }
  const from = "+18437734140";
  const to = "+18437581987";
  const zoneLabel = zone ? `Zone ${zone}` : "Unknown zone";
  const body = [
    `FSC NEW LEAD #${leadId}`,
    `Name: ${name || "n/a"}`,
    `Phone: ${phone || "n/a"}`,
    `City: ${city || "n/a"} (${zoneLabel})`,
    `Service: ${project_type || "n/a"}`,
    `Score: ${score}`,
    `Source: ${source}`,
    `Reply: RESPONDED ${leadId} / BOOKED ${leadId} / LOST ${leadId}`
  ].join("\n");
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + btoa(`${sid}:${token}`)
        },
        body: params.toString()
      }
    );
    if (!res.ok) {
      const e = await res.text();
      console.error(`Twilio SMS failed: ${res.status} \u2014 ${e}`);
      return { sent: false, reason: `twilio_${res.status}`, error: String(e).slice(0, 300) };
    }
    console.log(`SMS sent for lead #${leadId}`);
    return { sent: true, to };
  } catch (e) {
    console.error("Twilio SMS error:", e);
    return { sent: false, reason: "exception", error: e && e.message || String(e) };
  }
}
__name(sendLeadSMS, "sendLeadSMS");
__name2(sendLeadSMS, "sendLeadSMS");
__name22(sendLeadSMS, "sendLeadSMS");
var OPERATOR_NAME = "William";
var OPERATOR_COMPANY = "Allwayz Dumpster";
var FSC_MAIN_LINE = "(843) 938-0480";
var FSC_SMS_FROM = "+18437734140";
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, "");
  if (digits.length === 11 && digits[0] === "1") return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (String(raw).trim().startsWith("+") && digits.length >= 11 && digits.length <= 15) return "+" + digits;
  return null;
}
__name(normalizePhone, "normalizePhone");
__name2(normalizePhone, "normalizePhone");
function consentGiven(body) {
  const v = body && body.consent;
  if (v === false || v === 0) return false;
  if (typeof v === "string" && ["false", "0", "no", "off", ""].includes(v.toLowerCase())) return false;
  return true;
}
__name(consentGiven, "consentGiven");
__name2(consentGiven, "consentGiven");
async function sendCustomerSMS(env, { name, phone, service, city, source, consent }, leadId) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    console.warn("Twilio secrets missing \u2014 customer SMS skipped");
    return { sent: false, reason: "twilio_secrets_missing" };
  }
  if (!consent) {
    console.log(`Customer SMS skipped (no consent) for lead #${leadId}`);
    return { sent: false, reason: "no_consent" };
  }
  const to = normalizePhone(phone);
  if (!to) {
    console.log(`Customer SMS skipped (no valid phone) for lead #${leadId}`);
    return { sent: false, reason: "no_phone" };
  }
  if (to === FSC_SMS_FROM || to === "+18437581987") {
    return { sent: false, reason: "internal_number" };
  }
  const operatorPhone = env.OPERATOR_PHONE || FSC_MAIN_LINE;
  const firstName = (name || "").trim().split(/\s+/)[0] || "there";
  const serviceLabel = service && String(service).trim() ? String(service).trim() : "your dumpster rental";
  const cityStr = city ? String(city).trim() : "";
  const cityLabel = cityStr && !/^\d+$/.test(cityStr) ? ` in ${cityStr}` : "";
  const body = `Florence SC Services: Thanks, ${firstName}! Got your request for ${serviceLabel}${cityLabel}. ${OPERATOR_NAME} from our local crew (${OPERATOR_COMPANY}) will call you shortly from ${operatorPhone}. Questions? Reply here or call ${FSC_MAIN_LINE}. Reply STOP to opt out.`;
  const params = new URLSearchParams({ To: to, From: FSC_SMS_FROM, Body: body });
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + btoa(`${sid}:${token}`)
        },
        body: params.toString()
      }
    );
    if (!res.ok) {
      const e = await res.text();
      console.error(`Customer SMS failed: ${res.status} \u2014 ${e}`);
      return { sent: false, reason: `twilio_${res.status}` };
    }
    console.log(`Customer SMS sent for lead #${leadId} to ${to} (source=${source})`);
    return { sent: true, to };
  } catch (e) {
    console.error("Customer SMS error:", e);
    return { sent: false, reason: "exception" };
  }
}
__name(sendCustomerSMS, "sendCustomerSMS");
__name2(sendCustomerSMS, "sendCustomerSMS");
var LEAD_ALERT_TO = "cball8475@gmail.com";
var LEAD_ALERT_FROM = "leads@florencescservices.com";
async function sendLeadAlertEmail(env, { name, phone, city, zone, project_type, score, source }, leadId, smsResult) {
  if (!env.RESEND_API_KEY && !env.MAILER) {
    console.warn("RESEND_API_KEY not set and no MAILER binding \u2014 lead alert email skipped");
    return { sent: false, reason: "resend_key_missing" };
  }
  const zoneLabel = zone ? `Zone ${zone}` : "Unknown zone";
  const smsNote = smsResult && smsResult.sent ? "Owner SMS: sent (check your phone \u2014 if it never arrives, carrier/A2P filtering is dropping it)." : `Owner SMS: FAILED (${smsResult && smsResult.reason || "unknown"}${smsResult && smsResult.error ? " \u2014 " + smsResult.error : ""})`;
  const body = [
    `New FSC lead #${leadId}`,
    ``,
    `Name: ${name || "n/a"}`,
    `Phone: ${phone || "n/a"}`,
    `City: ${city || "n/a"} (${zoneLabel})`,
    `Service: ${project_type || "n/a"}`,
    `Score: ${score}`,
    `Source: ${source}`,
    ``,
    smsNote,
    ``,
    `Reply by text from your cell: RESPONDED ${leadId} / BOOKED ${leadId} / LOST ${leadId}`
  ].join("\n");
  const from = `FSC Leads <${env.LEAD_ALERT_FROM || LEAD_ALERT_FROM}>`;
  const to = env.LEAD_ALERT_TO || LEAD_ALERT_TO;
  const subject = `FSC NEW LEAD #${leadId} \u2014 ${String(score).toUpperCase()} \u2014 ${city || "unknown city"} (${zoneLabel})`;
  if (!env.RESEND_API_KEY && env.MAILER) {
    try {
      const r = await env.MAILER.send({ to, from, subject, text: body, kind: "owner_alert" });
      if (r && r.ok) {
        console.log(`Lead alert email sent via MAILER for lead #${leadId} (${r.id || "no-id"})`);
        return { sent: true, id: r.id || null, via: "mailer" };
      }
      console.error(`Lead alert email via MAILER failed: ${JSON.stringify(r).slice(0, 300)}`);
      return { sent: false, reason: r && r.reason || "mailer_failed", error: r && r.error || null, via: "mailer" };
    } catch (e) {
      console.error("Lead alert MAILER error:", e);
      return { sent: false, reason: "mailer_exception", error: e && e.message || String(e), via: "mailer" };
    }
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: body
      })
    });
    let detail = null;
    try {
      detail = await res.json();
    } catch {
    }
    if (!res.ok) {
      console.error(`Lead alert email failed: ${res.status} \u2014 ${JSON.stringify(detail).slice(0, 300)}`);
      return { sent: false, reason: `resend_${res.status}`, error: detail && (detail.message || detail.name) || null };
    }
    console.log(`Lead alert email sent for lead #${leadId} (${detail && detail.id})`);
    return { sent: true, id: detail && detail.id || null };
  } catch (e) {
    console.error("Lead alert email error:", e);
    return { sent: false, reason: "exception", error: e && e.message || String(e) };
  }
}
__name(sendLeadAlertEmail, "sendLeadAlertEmail");
__name2(sendLeadAlertEmail, "sendLeadAlertEmail");
async function notifyOwner(env, db, lead, leadId) {
  const sms = await sendLeadSMS(env, lead, leadId);
  const email = await sendLeadAlertEmail(env, lead, leadId, sms);
  await logLeadEvent(db, leadId, "owner_alert", { sms, email }, "system");
  return { sms, email };
}
__name(notifyOwner, "notifyOwner");
__name2(notifyOwner, "notifyOwner");
var MEMORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`;
var MEMORY_SEED = {
  category: "infrastructure",
  title: "2026-07-02 \u2014 lead-alert audit + Resend email backup (v2.23.0)",
  content: [
    "Lead alerts: every new lead (website form /submit-lead, CallRail /webhook/callrail, manual POST /leads) runs notifyOwner(): (1) Twilio SMS to operator cell from +18437734140, (2) backup email via Resend leads@florencescservices.com -> cball8475@gmail.com stating whether the SMS succeeded, (3) both results logged to lead_events as 'owner_alert' (check GET /leads/:id/events when texts seem missing).",
    "CallRail (verified live from swap.js config, company 322241453): (843) 938-0480 \u2014 the number on every site page \u2014 IS a CallRail tracking number; (843) 977-3419 is the second pool number; swap target 843-758-1987 (personal cell) appears nowhere on the site, so no call bypasses CallRail. Webhook to this worker confirmed working. Spam gate (v2.26.0): a CallRail call becomes a lead if Voice Assist captured real intake (product_service_interest/name/purpose) regardless of duration; calls with no intake are dropped when they are voicemail/unanswered or under SPAM_MIN_DURATION (38s). Confirmed VA field names from live payloads: body.voice_assist_message.contents.{name,purpose,product_service_interest,custom_question_1,custom_question_2}; ZIP is in call_summary text, not a structured field.",
    "Twilio: owner SMS delivery confirmed working 2026-07-02 (test leads #97-#99). If owner_alert shows sent:true but no text arrives, check Twilio Console messaging logs for carrier drops (error 30034).",
    "Deploy: worker auto-deploys from site-admin main via .github/workflows/deploy-worker.yml. Email alerts stay OFF until the RESEND_API_KEY Actions repo secret is added to site-admin and the workflow re-run (it syncs the secret to the worker). Until then owner_alert shows email reason resend_key_missing.",
    "Remote Claude sessions cannot set GitHub Actions secrets (proxy blocks Actions-secrets endpoints) and no Cloudflare/Twilio/Resend/API_TOKEN credentials exist in any repo \u2014 secret changes are a Charlie task via GitHub settings.",
    "FSC memory layers: this D1 memory table + site-admin kb/fsc-memory.md + GitHub history."
  ].join("\n\n")
};
var MEMORY_SEED_2 = {
  category: "infrastructure",
  title: "2026-07-10 \u2014 outreach system rebuild (crm-api v2.25.0, engine v2)",
  content: [
    "Outreach rebuilt end-to-end. florence-auto-outreach-emails (engine v2) now runs the whole supply-side pipeline on its Mon-Fri 12:00 UTC cron: Google Places discovery (dumpster + hauling, 50km around Florence) -> auto-reject filters (lead-gen/directories, national chains, out-of-area, uncontactable, dupes by place_id + name+phone) -> email scrape (D1 first, then operator website homepage/contact pages) -> auto-add via POST /prospects -> auto-enroll respecting zone exclusivity per (zone, vertical) -> Resend sends of due sequence steps (marked sent ONLY on Resend 2xx) -> daily digest email to charlie@florencescservices.com. Every action is a row in D1 outreach_log (query via GET /outreach-log on this API or the engine).",
    "Kill switch: data_store key 'outreach_toggle' (GET/POST /outreach-toggle here; also /toggle on the engine; dashboard has a switch). paused=true blocks all prospect sends but discovery/enroll/digest keep running as a dry-run. Default state on first touch is paused=true \u2014 cold email only starts after Charlie explicitly unpauses. Env var OUTREACH_PAUSED on the engine is a hard override.",
    "Suppression: D1 table 'suppression' (endpoints /suppression GET/POST/DELETE + ?email= check). Unsubscribes (signed one-click links in every email) land here permanently and every send checks it first. CAN-SPAM footer (postal address + unsubscribe) on every outreach email.",
    "Email plumbing: RESEND_API_KEY lives on florence-auto-outreach-emails; other workers send through its 'Mailer' WorkerEntrypoint service binding (MAILER) \u2014 florence-lead-followup v3 (Brevo removed, marks follow_up_N_sent only on confirmed send) and this worker's owner lead alerts fall back to MAILER when RESEND_API_KEY is absent here.",
    "Auth: engine + florence-outreach (Claude proxy, now locked down) accept the CRM bearer token; florence-outreach validates callers against GET /auth/check on this API. Dashboard reaches them through florence-dashboard-proxy routes /engine/* and /outreach/* (token injected server-side, behind Cloudflare Access).",
    "All five workers + dashboard live in site-admin (worker/* dirs, per-worker GitHub Actions deploys). See SYSTEM.md in the repo root for architecture, runbook, and the 5-touch sequence copy (offer: 1 month free, one operator per zone, first-come-first-serve on zones)."
  ].join("\n\n")
};
async function ensureMemorySeed(db) {
  await db.prepare(MEMORY_TABLE_SQL).run();
  await db.prepare("INSERT OR IGNORE INTO memory (category, title, content) VALUES (?, ?, ?)").bind(MEMORY_SEED.category, MEMORY_SEED.title, MEMORY_SEED.content).run();
  await db.prepare("INSERT OR IGNORE INTO memory (category, title, content) VALUES (?, ?, ?)").bind(MEMORY_SEED_2.category, MEMORY_SEED_2.title, MEMORY_SEED_2.content).run();
}
__name(ensureMemorySeed, "ensureMemorySeed");
__name2(ensureMemorySeed, "ensureMemorySeed");
var ZONE_NAMES = {
  "1": "Florence",
  "2": "Grand Strand",
  "3": "Georgetown / Williamsburg",
  "4": "Darlington County",
  "5": "Marion / Dillon",
  "6": "Chesterfield / Marlboro",
  "7": "Sumter / Lee / Clarendon"
};
var OUTREACH_TABLES_SQL = [
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
  `CREATE TABLE IF NOT EXISTS data_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))`
];
var outreachSchemaReady = false;
async function ensureOutreachSchema(db) {
  if (outreachSchemaReady) return;
  for (const sql of OUTREACH_TABLES_SQL) await db.prepare(sql).run();
  outreachSchemaReady = true;
}
__name(ensureOutreachSchema, "ensureOutreachSchema");
__name2(ensureOutreachSchema, "ensureOutreachSchema");
async function getOutreachToggle(db) {
  await ensureOutreachSchema(db);
  const row = await db.prepare("SELECT value, updated_at FROM data_store WHERE key = 'outreach_toggle'").first();
  if (!row) {
    const t = { paused: true, reason: "default safe state \u2014 never unpaused", updated_at: (/* @__PURE__ */ new Date()).toISOString(), updated_by: "system" };
    await db.prepare("INSERT OR REPLACE INTO data_store (key, value, updated_at) VALUES ('outreach_toggle', ?, datetime('now'))").bind(JSON.stringify(t)).run();
    return t;
  }
  try {
    return JSON.parse(row.value);
  } catch {
    return { paused: true, reason: "unparseable toggle value \u2014 failing safe", updated_at: row.updated_at, updated_by: "system" };
  }
}
__name(getOutreachToggle, "getOutreachToggle");
__name2(getOutreachToggle, "getOutreachToggle");
function pickFirst(...vals) {
  for (const v of vals) {
    if (v !== void 0 && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}
__name(pickFirst, "pickFirst");
__name2(pickFirst, "pickFirst");
var SERVICE_KEYWORDS = [
  ["junk removal", "junk removal"],
  ["junk", "junk removal"],
  ["roll off", "roll-off dumpster"],
  ["roll-off", "roll-off dumpster"],
  ["rolloff", "roll-off dumpster"],
  ["dumpster", "dumpster rental"],
  ["rental", "dumpster rental"],
  ["demolition", "demolition debris"],
  ["construction", "construction debris"],
  ["cleanout", "cleanout"],
  ["clean out", "cleanout"],
  ["clean-out", "cleanout"],
  ["yard waste", "yard waste"],
  ["concrete", "concrete/dirt"],
  ["dirt", "concrete/dirt"]
];
function detectServiceFromText(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  for (const [needle, label] of SERVICE_KEYWORDS) {
    if (t.includes(needle)) return label;
  }
  return null;
}
__name(detectServiceFromText, "detectServiceFromText");
__name2(detectServiceFromText, "detectServiceFromText");
function extractCallRailFields(body) {
  const va = body.voice_assist_message || {};
  const vc = va.ordered_content_with_overrides || va.contents || {};
  const summaryText = [vc.purpose, body.note, body.call_summary, body.summary, body.transcription, body.lead_explanation].filter(Boolean).join(" ");
  let service = pickFirst(vc.product_service_interest, body.project_type, body.service, body.service_type);
  if (!service && Array.isArray(body.tags) && body.tags.length) service = detectServiceFromText(body.tags.join(" "));
  if (!service && typeof body.tags === "string") service = detectServiceFromText(body.tags);
  if (!service) {
    service = detectServiceFromText(pickFirst(
      vc.purpose,
      body.lead_status,
      body.keywords,
      body.note,
      body.call_summary,
      body.summary,
      body.call_highlights,
      body.transcription,
      body.qualified_lead
    ));
  }
  const custom = body.custom || body.custom_fields || body.fields || null;
  if (!service && custom && typeof custom === "object") {
    service = pickFirst(custom.project_type, custom.service, custom.service_type, custom.what_service) || detectServiceFromText(Object.values(custom).join(" "));
  }
  let zip = pickFirst(body.zip_code, body.zip, body.postal_code, body.customer_postal_code, vc.zip_code, vc.zip);
  if (Array.isArray(zip)) zip = zip.length ? zip[0] : null;
  if (!zip && custom && typeof custom === "object") {
    zip = pickFirst(custom.zip_code, custom.zip, custom.postal_code);
  }
  if (!zip && summaryText) {
    const m = summaryText.match(/\b(2[5-9]\d{3})\b/);
    if (m) zip = m[1];
  }
  const city = pickFirst(body.customer_city, body.callercity, body.caller_city, body.city);
  const sizeSrc = [vc.product_service_interest, vc.purpose, vc.custom_question_1, vc.custom_question_2, body.call_summary].filter(Boolean).join(" ");
  const sizeMatch = sizeSrc.match(/(\d{1,2})\s*(?:-|\s)?\s*(?:yard|yd)\b/i);
  const dumpsterSize = sizeMatch ? `${sizeMatch[1]} yard` : null;
  const durSrc = [vc.purpose, vc.custom_question_1, vc.custom_question_2, body.call_summary].filter(Boolean).join(" ");
  const durMatch = durSrc.match(/(\d+)\s*(day|days|week|weeks|month|months)\b/i);
  const rentalDuration = durMatch ? `${durMatch[1]} ${durMatch[2].toLowerCase()}` : null;
  return {
    service: service ? String(service) : null,
    zip: zip ? String(zip).trim() : null,
    city: city ? String(city) : null,
    location: pickFirst(zip, city),
    dumpster_size: dumpsterSize,
    rental_duration: rentalDuration,
    notes: vc.purpose ? String(vc.purpose) : body.call_summary ? String(body.call_summary) : null
  };
}
__name(extractCallRailFields, "extractCallRailFields");
__name2(extractCallRailFields, "extractCallRailFields");
var GADS_CUSTOMER_ID = "6063111549";
var GADS_LOGIN_CUSTOMER_ID = "2443469323";
async function getGoogleAccessToken(env) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN
    }).toString()
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OAuth token refresh failed: ${res.status} \u2014 ${errText}`);
  }
  const data = await res.json();
  return data.access_token;
}
__name(getGoogleAccessToken, "getGoogleAccessToken");
__name2(getGoogleAccessToken, "getGoogleAccessToken");
__name22(getGoogleAccessToken, "getGoogleAccessToken");
async function queryGads(accessToken, devToken, query) {
  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "developer-token": devToken,
    "Content-Type": "application/json"
  };
  if (GADS_LOGIN_CUSTOMER_ID && GADS_LOGIN_CUSTOMER_ID !== GADS_CUSTOMER_ID) {
    headers["login-customer-id"] = GADS_LOGIN_CUSTOMER_ID;
  }
  const res = await fetch(
    `https://googleads.googleapis.com/v23/customers/${GADS_CUSTOMER_ID}/googleAds:search`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ query })
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Ads API error: ${res.status} \u2014 ${errText}`);
  }
  const data = await res.json();
  return data.results || [];
}
__name(queryGads, "queryGads");
__name2(queryGads, "queryGads");
__name22(queryGads, "queryGads");
async function resolveGeoNames(accessToken, devToken, criterionIds) {
  const names = {};
  if (!criterionIds.length) return names;
  const idList = criterionIds.map((id) => `'geoTargetConstants/${id}'`).join(", ");
  try {
    const query = `SELECT geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.resource_name FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${idList})`;
    const results = await queryGads(accessToken, devToken, query);
    for (const row of results) {
      const gtc = row.geoTargetConstant || {};
      const rn = gtc.resourceName || "";
      const idMatch = rn.match(/geoTargetConstants\/(\d+)/);
      if (idMatch) {
        names[idMatch[1]] = gtc.name || gtc.canonicalName || `ID:${idMatch[1]}`;
      }
    }
  } catch (e) {
    console.error("Geo name resolution failed, falling back:", e.message);
  }
  for (const id of criterionIds) {
    if (!names[id]) names[id] = `ID:${id}`;
  }
  return names;
}
__name(resolveGeoNames, "resolveGeoNames");
__name2(resolveGeoNames, "resolveGeoNames");
__name22(resolveGeoNames, "resolveGeoNames");
async function handleAdsMetrics(request, env) {
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN || !env.GOOGLE_ADS_REFRESH_TOKEN) {
    return err("Google Ads API credentials not configured \u2014 need GOOGLE_ADS_DEVELOPER_TOKEN + GOOGLE_ADS_REFRESH_TOKEN", 502);
  }
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) {
    return err("Google Ads OAuth credentials not configured \u2014 need GOOGLE_ADS_CLIENT_ID + GOOGLE_ADS_CLIENT_SECRET", 502);
  }
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7", 10);
  const now = /* @__PURE__ */ new Date();
  const currentEnd = now.toISOString().slice(0, 10);
  const currentStart = new Date(now - days * 864e5).toISOString().slice(0, 10);
  const prevEnd = new Date(now - days * 864e5 - 864e5).toISOString().slice(0, 10);
  const prevStart = new Date(now - days * 2 * 864e5).toISOString().slice(0, 10);
  try {
    const accessToken = await getGoogleAccessToken(env);
    const devToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const dailyQuery = `
      SELECT segments.date, campaign.name,
             metrics.clicks, metrics.impressions, metrics.cost_micros,
             metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${currentStart}' AND '${currentEnd}'
      ORDER BY segments.date`;
    const prevQuery = `
      SELECT metrics.clicks, metrics.impressions, metrics.cost_micros,
             metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${prevStart}' AND '${prevEnd}'`;
    const geoQuery = `
      SELECT segments.geo_target_most_specific_location,
             metrics.clicks, metrics.impressions, metrics.cost_micros,
             metrics.conversions
      FROM geographic_view
      WHERE segments.date BETWEEN '${currentStart}' AND '${currentEnd}'`;
    let dailyResults, prevResults, geoResults;
    try {
      dailyResults = await queryGads(accessToken, devToken, dailyQuery);
    } catch (e) {
      return err(`Daily query failed: ${e.message}`, 502);
    }
    try {
      prevResults = await queryGads(accessToken, devToken, prevQuery);
    } catch (e) {
      prevResults = [];
    }
    try {
      geoResults = await queryGads(accessToken, devToken, geoQuery);
    } catch (e) {
      geoResults = [];
    }
    const current = { clicks: 0, impressions: 0, spend: 0, conversions: 0 };
    const dailyMap = {};
    for (const row of dailyResults) {
      const m = row.metrics || {};
      const date = row.segments?.date || "unknown";
      const clicks = Number(m.clicks || 0);
      const impressions = Number(m.impressions || 0);
      const spend = Number(m.costMicros || 0) / 1e6;
      const conversions = Number(m.conversions || 0);
      current.clicks += clicks;
      current.impressions += impressions;
      current.spend += spend;
      current.conversions += conversions;
      if (!dailyMap[date]) dailyMap[date] = { date, clicks: 0, impressions: 0, spend: 0, conversions: 0 };
      dailyMap[date].clicks += clicks;
      dailyMap[date].impressions += impressions;
      dailyMap[date].spend += spend;
      dailyMap[date].conversions += conversions;
    }
    current.ctr = current.impressions > 0 ? (current.clicks / current.impressions * 100).toFixed(1) + "%" : "0%";
    current.cpc = current.clicks > 0 ? "$" + (current.spend / current.clicks).toFixed(2) : "$0.00";
    current.cost_per_conversion = current.conversions > 0 ? "$" + (current.spend / current.conversions).toFixed(2) : "N/A";
    current.spend_formatted = "$" + current.spend.toFixed(2);
    const previous = { clicks: 0, impressions: 0, spend: 0, conversions: 0 };
    for (const row of prevResults) {
      const m = row.metrics || {};
      previous.clicks += Number(m.clicks || 0);
      previous.impressions += Number(m.impressions || 0);
      previous.spend += Number(m.costMicros || 0) / 1e6;
      previous.conversions += Number(m.conversions || 0);
    }
    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
    const geoMap = {};
    for (const row of geoResults) {
      const m = row.metrics || {};
      const seg = row.segments || {};
      const locResource = seg.geoTargetMostSpecificLocation || seg.geo_target_most_specific_location || seg.geoTargetCity || seg.geo_target_city || "";
      const locStr = String(locResource);
      const idMatch = locStr.match(/geoTargetConstants\/(\d+)/);
      const criterionId = idMatch ? idMatch[1] : locStr.match(/^\d+$/) ? locStr : "unknown";
      if (!geoMap[criterionId]) geoMap[criterionId] = { criterionId, clicks: 0, impressions: 0, spend: 0, conversions: 0 };
      geoMap[criterionId].clicks += Number(m.clicks || 0);
      geoMap[criterionId].impressions += Number(m.impressions || 0);
      geoMap[criterionId].spend += Number(m.costMicros || 0) / 1e6;
      geoMap[criterionId].conversions += Number(m.conversions || 0);
    }
    const criterionIds = Object.keys(geoMap).filter((id) => id !== "unknown");
    const geoNames = criterionIds.length > 0 ? await resolveGeoNames(accessToken, devToken, [...criterionIds]) : {};
    const geo = Object.values(geoMap).map((g) => ({
      city: geoNames[g.criterionId] || `ID:${g.criterionId}`,
      clicks: g.clicks,
      impressions: g.impressions,
      spend: g.spend,
      conversions: g.conversions
    })).sort((a, b) => b.clicks - a.clicks).slice(0, 15);
    const targetCities = [
      "florence",
      "effingham",
      "timmonsville",
      "darlington",
      "hartsville",
      "lamar",
      "lake city",
      "pamplico",
      "johnsonville",
      "scranton",
      "coward"
    ];
    const targetZones = ["1", "4"];
    const geoWithZones = geo.map((g) => {
      const cityLower = (g.city || "").toLowerCase();
      const zoneFromDetect = detectZone(cityLower);
      const matchesCity = targetCities.some((tc) => cityLower.includes(tc));
      const inZone = matchesCity || zoneFromDetect && targetZones.includes(zoneFromDetect);
      return { ...g, zone: zoneFromDetect, in_zone: inZone };
    });
    const outOfZone = geoWithZones.filter((g) => !g.in_zone);
    const result = {
      period_days: days,
      current_range: { start: currentStart, end: currentEnd },
      previous_range: { start: prevStart, end: prevEnd },
      current: { totals: current },
      previous: { totals: previous },
      daily,
      geo: geoWithZones,
      out_of_zone: outOfZone,
      fetched_at: (/* @__PURE__ */ new Date()).toISOString(),
      source: "google_ads_api"
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=300, must-revalidate",
        ...CORS
      }
    });
  } catch (e) {
    console.error("Google Ads API metrics error:", e);
    return err(`Failed to fetch ads metrics: ${e.message}`, 502);
  }
}
__name(handleAdsMetrics, "handleAdsMetrics");
__name2(handleAdsMetrics, "handleAdsMetrics");
__name22(handleAdsMetrics, "handleAdsMetrics");
var GSC_SITE_URL = "https://florencescservices.com/";
async function handleGscMetrics(request, env) {
  if (!env.GOOGLE_ADS_REFRESH_TOKEN || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) {
    return err("Google OAuth credentials not configured", 502);
  }
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7", 10);
  const now = /* @__PURE__ */ new Date();
  const lagDays = 3;
  const endDate = new Date(now - lagDays * 864e5).toISOString().slice(0, 10);
  const startDate = new Date(now - (days + lagDays) * 864e5).toISOString().slice(0, 10);
  const prevEnd = new Date(now - (days + lagDays) * 864e5 - 864e5).toISOString().slice(0, 10);
  const prevStart = new Date(now - (days * 2 + lagDays) * 864e5).toISOString().slice(0, 10);
  try {
    const accessToken = await getGoogleAccessToken(env);
    const siteUrl = encodeURIComponent(GSC_SITE_URL);
    const apiBase = `https://searchconsole.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`;
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    };
    const queriesRes = await fetch(apiBase, {
      method: "POST",
      headers,
      body: JSON.stringify({ startDate, endDate, dimensions: ["query"], rowLimit: 100 })
    });
    const pagesRes = await fetch(apiBase, {
      method: "POST",
      headers,
      body: JSON.stringify({ startDate, endDate, dimensions: ["page"], rowLimit: 50 })
    });
    const dailyRes = await fetch(apiBase, {
      method: "POST",
      headers,
      body: JSON.stringify({ startDate, endDate, dimensions: ["date"], rowLimit: 500 })
    });
    const prevRes = await fetch(apiBase, {
      method: "POST",
      headers,
      body: JSON.stringify({ startDate: prevStart, endDate: prevEnd })
    });
    const currentAggRes = await fetch(apiBase, {
      method: "POST",
      headers,
      body: JSON.stringify({ startDate, endDate })
    });
    if (!queriesRes.ok) {
      const errText = await queriesRes.text();
      return err(`GSC API error: ${queriesRes.status} \u2014 ${errText.slice(0, 300)}`, 502);
    }
    const [queriesData, pagesData, dailyData, prevData, currentAggData] = await Promise.all([
      queriesRes.json(),
      pagesRes.ok ? pagesRes.json() : { rows: [] },
      dailyRes.ok ? dailyRes.json() : { rows: [] },
      prevRes.ok ? prevRes.json() : { rows: [] },
      currentAggRes.ok ? currentAggRes.json() : { rows: [] }
    ]);
    const queryRows = (queriesData.rows || []).map((r) => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: (r.ctr * 100).toFixed(1) + "%",
      position: r.position.toFixed(1)
    }));
    const pageRows = (pagesData.rows || []).map((r) => ({
      path: r.keys[0].replace(GSC_SITE_URL, "/"),
      page: r.keys[0].replace(GSC_SITE_URL, "/"),
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: (r.ctr * 100).toFixed(1) + "%",
      position: r.position.toFixed(1)
    }));
    const dailyRows = (dailyData.rows || []).map((r) => ({
      date: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: (r.ctr * 100).toFixed(1) + "%",
      position: r.position.toFixed(1)
    })).sort((a, b) => a.date.localeCompare(b.date));
    const currentAggRow = (currentAggData.rows || [])[0] || {};
    const currentTotals = {
      clicks: currentAggRow.clicks || 0,
      impressions: currentAggRow.impressions || 0,
      ctr: currentAggRow.ctr ? (currentAggRow.ctr * 100).toFixed(1) + "%" : "0%",
      position: currentAggRow.position ? currentAggRow.position.toFixed(1) : "N/A"
    };
    const prevRow = (prevData.rows || [])[0] || {};
    const previousTotals = {
      clicks: prevRow.clicks || 0,
      impressions: prevRow.impressions || 0,
      ctr: prevRow.ctr ? (prevRow.ctr * 100).toFixed(1) + "%" : "0%",
      position: prevRow.position ? prevRow.position.toFixed(1) : "N/A"
    };
    const result = {
      period_days: days,
      current_range: { start: startDate, end: endDate },
      previous_range: { start: prevStart, end: prevEnd },
      note: "GSC data has ~3 day lag",
      // Flat totals — the deployed dashboard reads seo.totals.{clicks,impressions,ctr,avg_position}
      totals: { ...currentTotals, avg_position: currentTotals.position },
      current: { totals: currentTotals },
      previous: { totals: previousTotals },
      top_queries: queryRows,
      top_pages: pageRows,
      daily: dailyRows,
      fetched_at: (/* @__PURE__ */ new Date()).toISOString(),
      source: "google_search_console"
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=300, must-revalidate",
        ...CORS
      }
    });
  } catch (e) {
    console.error("GSC API error:", e);
    return err(`Failed to fetch GSC metrics: ${e.message}`, 502);
  }
}
__name(handleGscMetrics, "handleGscMetrics");
__name2(handleGscMetrics, "handleGscMetrics");
__name22(handleGscMetrics, "handleGscMetrics");
async function handleAdsSearchTerms(request, env) {
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN || !env.GOOGLE_ADS_REFRESH_TOKEN) {
    return err("Google Ads API credentials not configured", 502);
  }
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) {
    return err("Google Ads OAuth credentials not configured", 502);
  }
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7", 10);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const now = /* @__PURE__ */ new Date();
  const endDate = now.toISOString().slice(0, 10);
  const startDate = new Date(now - days * 864e5).toISOString().slice(0, 10);
  try {
    const accessToken = await getGoogleAccessToken(env);
    const devToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const searchTermQuery = `
      SELECT search_term_view.search_term,
             search_term_view.status,
             campaign.name,
             ad_group.name,
             metrics.clicks, metrics.impressions, metrics.cost_micros,
             metrics.conversions, metrics.ctr, metrics.average_cpc
      FROM search_term_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND metrics.impressions > 0
      ORDER BY metrics.impressions DESC
      LIMIT ${limit}`;
    const keywordQuery = `
      SELECT ad_group_criterion.keyword.text,
             ad_group_criterion.keyword.match_type,
             campaign.name,
             metrics.clicks, metrics.impressions, metrics.cost_micros,
             metrics.search_impression_share,
             metrics.search_rank_lost_impression_share,
             metrics.search_budget_lost_impression_share,
             metrics.search_top_impression_share,
             metrics.search_absolute_top_impression_share
      FROM keyword_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND ad_group_criterion.status != 'REMOVED'
        AND metrics.impressions > 0
      ORDER BY metrics.impressions DESC
      LIMIT 50`;
    let searchTermResults, keywordResults;
    try {
      searchTermResults = await queryGads(accessToken, devToken, searchTermQuery);
    } catch (e) {
      return err("Search terms query failed: " + e.message, 502);
    }
    try {
      keywordResults = await queryGads(accessToken, devToken, keywordQuery);
    } catch (e) {
      keywordResults = [];
    }
    const searchTerms = searchTermResults.map((row) => {
      const m = row.metrics || {};
      const stv = row.searchTermView || {};
      return {
        search_term: stv.searchTerm || "unknown",
        status: stv.status || "UNSPECIFIED",
        campaign: row.campaign?.name || "unknown",
        ad_group: row.adGroup?.name || "unknown",
        clicks: Number(m.clicks || 0),
        impressions: Number(m.impressions || 0),
        ctr: m.ctr ? (Number(m.ctr) * 100).toFixed(1) + "%" : "0%",
        avg_cpc: m.averageCpc ? "$" + (Number(m.averageCpc) / 1e6).toFixed(2) : "$0.00",
        spend: Number(m.costMicros || 0) / 1e6,
        conversions: Number(m.conversions || 0)
      };
    });
    const termTotals = {
      unique_terms: searchTerms.length,
      total_clicks: searchTerms.reduce((s, t) => s + t.clicks, 0),
      total_impressions: searchTerms.reduce((s, t) => s + t.impressions, 0),
      total_spend: searchTerms.reduce((s, t) => s + t.spend, 0)
    };
    const keywords = keywordResults.map((row) => {
      const m = row.metrics || {};
      const kw = row.adGroupCriterion?.keyword || {};
      return {
        keyword: kw.text || "unknown",
        match_type: kw.matchType || "UNSPECIFIED",
        campaign: row.campaign?.name || "unknown",
        clicks: Number(m.clicks || 0),
        impressions: Number(m.impressions || 0),
        spend: Number(m.costMicros || 0) / 1e6,
        search_impression_share: m.searchImpressionShare ?? null,
        search_rank_lost_is: m.searchRankLostImpressionShare ?? null,
        search_budget_lost_is: m.searchBudgetLostImpressionShare ?? null,
        search_top_is: m.searchTopImpressionShare ?? null,
        search_abs_top_is: m.searchAbsoluteTopImpressionShare ?? null
      };
    });
    const competitorPressure = keywords.filter((k) => k.search_rank_lost_is !== null && k.search_rank_lost_is > 0.1).sort((a, b) => (b.search_rank_lost_is || 0) - (a.search_rank_lost_is || 0));
    const result = {
      period_days: days,
      date_range: { start: startDate, end: endDate },
      search_terms: searchTerms,
      search_term_totals: termTotals,
      keyword_impression_share: keywords,
      competitor_pressure: competitorPressure,
      fetched_at: (/* @__PURE__ */ new Date()).toISOString(),
      source: "google_ads_api"
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=300, must-revalidate",
        ...CORS
      }
    });
  } catch (e) {
    console.error("Google Ads search terms error:", e);
    return err("Failed to fetch search terms: " + e.message, 502);
  }
}
__name(handleAdsSearchTerms, "handleAdsSearchTerms");
__name2(handleAdsSearchTerms, "handleAdsSearchTerms");
__name22(handleAdsSearchTerms, "handleAdsSearchTerms");
var SNAPSHOT_TABLES_SQL = [
  `CREATE TABLE IF NOT EXISTS seo_fix_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fix_id INTEGER NOT NULL,
    query TEXT NOT NULL,
    position REAL,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    snapshot_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(fix_id, snapshot_date)
  )`,
  `CREATE TABLE IF NOT EXISTS seo_cron_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job TEXT NOT NULL,
    status TEXT NOT NULL,
    fixes_total INTEGER DEFAULT 0,
    fixes_matched INTEGER DEFAULT 0,
    fixes_missed TEXT,
    error_message TEXT,
    ran_at TEXT DEFAULT (datetime('now'))
  )`
];
async function handleSeoSnapshot(env) {
  var db = env.DB;
  for (var sql of SNAPSHOT_TABLES_SQL) {
    await db.prepare(sql).run();
  }
  var log = { job: "seo-position-snapshot", status: "success", fixes_total: 0, fixes_matched: 0, fixes_missed: null, error_message: null };
  try {
    await db.prepare("CREATE TABLE IF NOT EXISTS seo_fixes (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL, page TEXT NOT NULL, status TEXT DEFAULT 'monitoring', suggested_fix TEXT, baseline_pos REAL, started_at TEXT, graduated_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))").run();
    var fixesResult = await db.prepare("SELECT * FROM seo_fixes").all();
    var fixes = fixesResult.results || [];
    if (fixes.length === 0) {
      log.error_message = "No fixes exist \u2014 nothing to snapshot";
      await db.prepare("INSERT INTO seo_cron_log (job, status, fixes_total, fixes_matched, fixes_missed, error_message) VALUES (?, ?, ?, ?, ?, ?)").bind(log.job, log.status, 0, 0, null, log.error_message).run();
      return log;
    }
    log.fixes_total = fixes.length;
    if (!env.GOOGLE_ADS_REFRESH_TOKEN || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) {
      throw new Error("FATAL: Google OAuth secrets missing (GOOGLE_ADS_REFRESH_TOKEN / CLIENT_ID / CLIENT_SECRET). Cannot query GSC.");
    }
    var accessToken = await getGoogleAccessToken(env);
    var now2 = /* @__PURE__ */ new Date();
    var lagDays = 3;
    var endDate = new Date(now2 - lagDays * 864e5).toISOString().slice(0, 10);
    var startDate = new Date(now2 - (7 + lagDays) * 864e5).toISOString().slice(0, 10);
    var siteUrl = encodeURIComponent(GSC_SITE_URL);
    var apiBase = "https://searchconsole.googleapis.com/webmasters/v3/sites/" + siteUrl + "/searchAnalytics/query";
    var queriesRes = await fetch(apiBase, {
      method: "POST",
      headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, dimensions: ["query"], rowLimit: 100 })
    });
    if (!queriesRes.ok) {
      var errBody = await queriesRes.text();
      throw new Error("GSC API " + queriesRes.status + ": " + errBody.slice(0, 300));
    }
    var queriesData = await queriesRes.json();
    var gscRows = (queriesData.rows || []).map(function(r) {
      return { query: r.keys[0].toLowerCase(), position: r.position, impressions: r.impressions, clicks: r.clicks };
    });
    await db.prepare("CREATE TABLE IF NOT EXISTS data_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))").run();
    await db.prepare("INSERT OR REPLACE INTO data_store (key, value, updated_at) VALUES ('gsc_top_queries', ?, datetime('now'))").bind(JSON.stringify({
      start_date: startDate,
      end_date: endDate,
      rows: (queriesData.rows || []).map(function(r) {
        return { query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position };
      })
    })).run();
    var snapshotDate = now2.toISOString().slice(0, 10);
    var missed = [];
    var filtered = await Promise.all(fixes.map(function(fix2) {
      return fetch(apiBase, {
        method: "POST",
        headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensionFilterGroups: [{ filters: [{ dimension: "query", operator: "equals", expression: fix2.query }] }]
        })
      }).then(function(r) {
        return r.ok ? r.json() : { rows: [] };
      }).catch(function() {
        return { rows: [] };
      });
    }));
    for (var i = 0; i < fixes.length; i++) {
      var fix = fixes[i];
      var fRow = (filtered[i].rows || [])[0];
      var match = fRow && fRow.impressions > 0 ? { position: fRow.position, impressions: fRow.impressions, clicks: fRow.clicks } : null;
      if (!match) {
        var fixQuery = (fix.query || "").toLowerCase();
        for (var j = 0; j < gscRows.length; j++) {
          if (gscRows[j].query === fixQuery) {
            match = gscRows[j];
            break;
          }
        }
      }
      await db.prepare(
        "INSERT OR REPLACE INTO seo_fix_snapshots (fix_id, query, position, impressions, clicks, snapshot_date) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(
        fix.id,
        fix.query,
        match ? match.position : null,
        match ? match.impressions : 0,
        match ? match.clicks : 0,
        snapshotDate
      ).run();
      if (match) {
        log.fixes_matched++;
      } else {
        missed.push(fix.query);
      }
    }
    if (missed.length > 0) {
      log.fixes_missed = JSON.stringify(missed);
    }
    await db.prepare(
      "INSERT INTO seo_cron_log (job, status, fixes_total, fixes_matched, fixes_missed, error_message) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(log.job, "success", log.fixes_total, log.fixes_matched, log.fixes_missed, null).run();
    console.log("SEO snapshot OK: " + log.fixes_matched + "/" + log.fixes_total + " matched");
    return log;
  } catch (e) {
    log.status = "error";
    log.error_message = e.message || String(e);
    console.error("SEO snapshot FAILED:", log.error_message);
    try {
      await db.prepare(
        "INSERT INTO seo_cron_log (job, status, fixes_total, fixes_matched, fixes_missed, error_message) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(log.job, "error", log.fixes_total, log.fixes_matched, log.fixes_missed, log.error_message).run();
    } catch (logErr) {
      console.error("DOUBLE FAULT \u2014 could not write cron error to D1:", logErr);
    }
    return log;
  }
}
__name(handleSeoSnapshot, "handleSeoSnapshot");
__name2(handleSeoSnapshot, "handleSeoSnapshot");
__name22(handleSeoSnapshot, "handleSeoSnapshot");
var worker_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const db = env.DB;
    if (path === "/submit-lead" && method === "POST") return handleFormSubmission(request, db, env);
    if (path === "/webhook/callrail" && method === "POST") return handleCallRailWebhook(request, db, env);
    if (path === "/webhook/twilio-inbound" && method === "POST") return handleTwilioInbound(request, db, env);
    if (path === "/webhook/mercury" && (method === "POST" || method === "GET")) return handleMercuryWebhook(request, db, env);
    if (path === "/health" && method === "GET") {
      return json({ status: "ok", version: "2.26.0", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    }
    if (path === "/health/db" && method === "GET") {
      try {
        if (!db) return json({ ok: false, error: "env.DB is undefined \u2014 binding not present", checked_at: (/* @__PURE__ */ new Date()).toISOString(), version: "2.26.0" }, 503);
        const result = await db.prepare("SELECT 1 as ping").first();
        const dbOk = result?.ping === 1;
        await ensureMemorySeed(db);
        const mem = await db.prepare("SELECT COUNT(*) as c FROM memory").first();
        return json({ ok: dbOk, memory_rows: mem?.c ?? 0, checked_at: (/* @__PURE__ */ new Date()).toISOString(), version: "2.26.0" }, dbOk ? 200 : 503);
      } catch (e) {
        return json({ ok: false, error: e.message || "D1 query failed", checked_at: (/* @__PURE__ */ new Date()).toISOString(), version: "2.26.0" }, 503);
      }
    }
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (token !== env.API_TOKEN) return err("Unauthorized", 401);
    try {
      if (path === "/ads/metrics" && method === "GET") return handleAdsMetrics(request, env);
      if (path === "/ads/search-terms" && method === "GET") return handleAdsSearchTerms(request, env);
      if (path === "/ads/campaign-criteria" && method === "GET") return handleAdsCampaignCriteria(request, env);
      if ((path === "/gsc/metrics" || path === "/seo/metrics") && method === "GET") return handleGscMetrics(request, env);
      if (path === "/memory" && method === "GET") {
        await ensureMemorySeed(db);
        const q = url.searchParams.get("q");
        const category = url.searchParams.get("category");
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
        const conds = [], vals = [];
        if (q) {
          conds.push("(title LIKE ? OR content LIKE ?)");
          vals.push(`%${q}%`, `%${q}%`);
        }
        if (category) {
          conds.push("category = ?");
          vals.push(category);
        }
        let sql3 = "SELECT * FROM memory" + (conds.length ? " WHERE " + conds.join(" AND ") : "") + " ORDER BY created_at DESC, id DESC LIMIT ?";
        vals.push(limit);
        const { results } = await db.prepare(sql3).bind(...vals).all();
        return json({ memory: results || [] });
      }
      if (path === "/memory" && method === "POST") {
        await ensureMemorySeed(db);
        const body = await request.json();
        if (!body.title || !body.content) return err("Required: title, content");
        const ins = await db.prepare(
          "INSERT INTO memory (category, title, content) VALUES (?, ?, ?) ON CONFLICT(title) DO UPDATE SET content = excluded.content, category = excluded.category, updated_at = datetime('now')"
        ).bind(body.category || "general", body.title, body.content).run();
        return json({ success: true, id: ins.meta?.last_row_id || null }, 201);
      }
      if (path === "/competitors/auction-insights" && method === "GET") {
        await db.prepare("CREATE TABLE IF NOT EXISTS data_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))").run();
        const row = await db.prepare("SELECT value, updated_at FROM data_store WHERE key = 'auction_insights'").first();
        if (!row) return err("No auction insights data uploaded yet", 404);
        const data = JSON.parse(row.value);
        data.stored_at = row.updated_at;
        return json(data);
      }
      if (path === "/competitors/auction-insights" && method === "POST") {
        await db.prepare("CREATE TABLE IF NOT EXISTS data_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))").run();
        const body = await request.json();
        await db.prepare("INSERT OR REPLACE INTO data_store (key, value, updated_at) VALUES ('auction_insights', ?, datetime('now'))").bind(JSON.stringify(body)).run();
        return json({ success: true, message: "Auction insights data stored" });
      }
      if (path === "/seo/backlinks" && method === "GET") {
        await db.prepare("CREATE TABLE IF NOT EXISTS data_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))").run();
        const row = await db.prepare("SELECT value, updated_at FROM data_store WHERE key = 'backlinks'").first();
        if (!row) return err("No backlinks data uploaded yet", 404);
        const data = JSON.parse(row.value);
        data.stored_at = row.updated_at;
        return json(data);
      }
      if (path === "/seo/backlinks" && method === "POST") {
        await db.prepare("CREATE TABLE IF NOT EXISTS data_store (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')))").run();
        const body = await request.json();
        await db.prepare("INSERT OR REPLACE INTO data_store (key, value, updated_at) VALUES ('backlinks', ?, datetime('now'))").bind(JSON.stringify(body)).run();
        return json({ success: true, message: "Backlinks data stored" });
      }
      if (path === "/seo/fixes" && method === "GET") {
        await db.prepare("CREATE TABLE IF NOT EXISTS seo_fixes (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL, page TEXT NOT NULL, status TEXT DEFAULT 'monitoring', suggested_fix TEXT, baseline_pos REAL, started_at TEXT, graduated_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))").run();
        const { results } = await db.prepare("SELECT * FROM seo_fixes ORDER BY created_at DESC").all();
        return json({ fixes: results || [] });
      }
      if (path === "/seo/fixes" && method === "POST") {
        await db.prepare("CREATE TABLE IF NOT EXISTS seo_fixes (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL, page TEXT NOT NULL, status TEXT DEFAULT 'monitoring', suggested_fix TEXT, baseline_pos REAL, started_at TEXT, graduated_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))").run();
        const body = await request.json();
        if (!body.query || !body.page) return err("Required: query, page");
        const ins = await db.prepare("INSERT INTO seo_fixes (query, page, status, suggested_fix, baseline_pos, started_at) VALUES (?, ?, ?, ?, ?, datetime('now'))").bind(body.query, body.page, body.status || "monitoring", body.suggested_fix || null, body.baseline_pos || null).run();
        return json({ success: true, id: ins.meta?.last_row_id });
      }
      if (path === "/seo/fixes" && method === "PATCH") {
        const body = await request.json();
        if (!body.id) return err("Required: id");
        const sets = [], vals = [];
        if (body.query !== void 0) {
          sets.push("query = ?");
          vals.push(body.query);
        }
        if (body.page !== void 0) {
          sets.push("page = ?");
          vals.push(body.page);
        }
        if (body.status !== void 0) {
          sets.push("status = ?");
          vals.push(body.status);
        }
        if (body.graduated_at !== void 0) {
          sets.push("graduated_at = ?");
          vals.push(body.graduated_at);
        }
        if (body.baseline_pos != null) {
          sets.push("baseline_pos = ?");
          vals.push(body.baseline_pos);
        }
        if (body.suggested_fix !== void 0) {
          sets.push("suggested_fix = ?");
          vals.push(body.suggested_fix);
        }
        sets.push("updated_at = datetime('now')");
        vals.push(body.id);
        await db.prepare("UPDATE seo_fixes SET " + sets.join(", ") + " WHERE id = ?").bind(...vals).run();
        return json({ success: true });
      }
      if (path === "/seo/fixes" && method === "DELETE") {
        const fixId = url.searchParams.get("id");
        if (!fixId) return err("Required: id query param");
        await db.prepare("DELETE FROM seo_fixes WHERE id = ?").bind(fixId).run();
        return json({ success: true });
      }
      if (path === "/seo/fixes/history" && method === "GET") {
        for (var sql of SNAPSHOT_TABLES_SQL) {
          await db.prepare(sql).run();
        }
        const fixId2 = url.searchParams.get("fix_id");
        const limit2 = parseInt(url.searchParams.get("limit") || "90", 10);
        let histQ, histP;
        if (fixId2) {
          histQ = "SELECT * FROM seo_fix_snapshots WHERE fix_id = ? ORDER BY snapshot_date DESC LIMIT ?";
          histP = [parseInt(fixId2), limit2];
        } else {
          histQ = "SELECT * FROM seo_fix_snapshots ORDER BY snapshot_date DESC LIMIT ?";
          histP = [limit2];
        }
        const { results: snaps } = await db.prepare(histQ).bind(...histP).all();
        return json({ snapshots: snaps || [] });
      }
      if (path === "/seo/fixes/snapshot-status" && method === "GET") {
        for (var sql2 of SNAPSHOT_TABLES_SQL) {
          await db.prepare(sql2).run();
        }
        const lastRun = await db.prepare("SELECT * FROM seo_cron_log WHERE job = 'seo-position-snapshot' ORDER BY ran_at DESC LIMIT 1").first();
        const lastOk = await db.prepare("SELECT * FROM seo_cron_log WHERE job = 'seo-position-snapshot' AND status = 'success' ORDER BY ran_at DESC LIMIT 1").first();
        const recentErrors = await db.prepare("SELECT * FROM seo_cron_log WHERE job = 'seo-position-snapshot' AND status = 'error' ORDER BY ran_at DESC LIMIT 5").all();
        return json({ last_run: lastRun || null, last_success: lastOk || null, recent_errors: recentErrors.results || [] });
      }
      if (path === "/seo/fixes/snapshot" && method === "POST") {
        const result = await handleSeoSnapshot(env);
        return json({ success: result.status === "success", ...result });
      }
      if (path === "/github-push" && method === "POST") {
        const ghToken = env.GITHUB_TOKEN;
        if (!ghToken) return err("GITHUB_TOKEN secret not configured on florence-crm-api", 503);
        const body = await request.json();
        if (!body.path || !body.content || !body.message) return err("Required fields: path, content, message");
        const repo = body.repo || "cball8475/cball8475.github.io";
        const apiBase = `https://api.github.com/repos/${repo}/contents/${body.path}`;
        const ghHeaders = {
          "Authorization": `token ${ghToken}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "fsc-crm-api"
        };
        let sha = null;
        try {
          const getRes = await fetch(apiBase + "?_t=" + Date.now(), { headers: ghHeaders });
          if (getRes.ok) {
            const fd = await getRes.json();
            sha = fd.sha;
          } else if (getRes.status !== 404) return err(`GitHub GET failed: ${getRes.status}`, 502);
        } catch (e) {
          return err(`GitHub GET error: ${e.message}`, 502);
        }
        const encoded = btoa(unescape(encodeURIComponent(body.content)));
        const payload = { message: body.message, content: encoded };
        if (sha) payload.sha = sha;
        try {
          const putRes = await fetch(apiBase, { method: "PUT", headers: ghHeaders, body: JSON.stringify(payload) });
          if (!putRes.ok) {
            const errBody = await putRes.text();
            return err(`GitHub PUT failed: ${putRes.status} \u2014 ${errBody}`, 502);
          }
          const putData = await putRes.json();
          return json({ success: true, commit: putData.commit.sha, path: body.path, repo });
        } catch (e) {
          return err(`GitHub PUT error: ${e.message}`, 502);
        }
      }
      if (path === "/github-inject-pixel" && method === "POST") {
        const ghToken2 = env.GITHUB_TOKEN;
        if (!ghToken2) return err("GITHUB_TOKEN not configured", 503);
        const body2 = await request.json();
        if (!body2.path) return err("Required: path");
        const repo2 = body2.repo || "cball8475/cball8475.github.io";
        const pixelId = body2.pixel_id || "1343558614357307";
        const apiUrl = `https://api.github.com/repos/${repo2}/contents/${body2.path}`;
        const gh = {
          "Authorization": `token ${ghToken2}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "fsc-crm-api"
        };
        try {
          const getR = await fetch(apiUrl + "?_t=" + Date.now(), { headers: gh, cf: { cacheTtl: 0 } });
          if (!getR.ok) return err(`GET failed: ${getR.status}`, 502);
          const fileData = await getR.json();
          const currentSha = fileData.sha;
          const raw = atob(fileData.content.replace(/\n/g, ""));
          if (raw.includes(pixelId)) return json({ success: true, skipped: true, reason: "pixel already present" });
          const pixelCode = `  <!-- Meta Pixel Code -->
  <script>
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '${pixelId}');
  fbq('track', 'PageView');
  <\/script>
  <noscript><img height="1" width="1" style="display:none"
  src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"
  /></noscript>
  <!-- End Meta Pixel Code -->`;
          let modified = raw;
          const titleMatch = raw.match(/\n(\s*<title)/i);
          const headMatch = raw.match(/\n(\s*<\/head>)/i);
          if (titleMatch) {
            const idx = raw.indexOf(titleMatch[0]);
            modified = raw.slice(0, idx) + "\n" + pixelCode + raw.slice(idx);
          } else if (headMatch) {
            const idx = raw.indexOf(headMatch[0]);
            modified = raw.slice(0, idx) + "\n" + pixelCode + raw.slice(idx);
          } else {
            return err("No <title> or </head> found in file");
          }
          const encoded2 = btoa(unescape(encodeURIComponent(modified)));
          const putR = await fetch(apiUrl, {
            method: "PUT",
            headers: gh,
            body: JSON.stringify({ message: `Add Meta Pixel (${pixelId}) to ${body2.path}`, content: encoded2, sha: currentSha }),
            cf: { cacheTtl: 0 }
          });
          if (!putR.ok) {
            const eb = await putR.text();
            return err(`PUT failed: ${putR.status} - ${eb}`, 502);
          }
          const putD = await putR.json();
          return json({ success: true, commit: putD.commit.sha, path: body2.path });
        } catch (e) {
          return err(`inject-pixel error: ${e.message}`, 502);
        }
      }
      if (path === "/prospects" && method === "GET") {
        const stage = url.searchParams.get("stage");
        const enrolled = url.searchParams.get("enrolled");
        const operatorStatus = url.searchParams.get("operator_status");
        let sql3 = "SELECT * FROM prospects";
        const params = [];
        const conditions = [];
        if (stage) {
          conditions.push("stage = ?");
          params.push(stage);
        }
        if (enrolled === "true") conditions.push("sequence IS NOT NULL");
        if (enrolled === "false") conditions.push("sequence IS NULL");
        if (operatorStatus) {
          conditions.push("operator_status = ?");
          params.push(operatorStatus);
        }
        const vertical = url.searchParams.get("vertical");
        if (vertical) {
          conditions.push("vertical = ?");
          params.push(vertical);
        }
        const zone = url.searchParams.get("zone");
        if (zone) {
          conditions.push("default_zone = ?");
          params.push(zone);
        }
        if (conditions.length) sql3 += " WHERE " + conditions.join(" AND ");
        sql3 += " ORDER BY updated_at DESC";
        const { results } = await db.prepare(sql3).bind(...params).all();
        return json({ prospects: results, count: results.length });
      }
      if (matchPath(path, "/prospects/:id") && method === "GET") {
        const [id] = matchPath(path, "/prospects/:id");
        const prospect = await db.prepare("SELECT * FROM prospects WHERE id = ?").bind(id).first();
        if (!prospect) return err("Not found", 404);
        const { results: activities } = await db.prepare("SELECT * FROM activities WHERE prospect_id = ? ORDER BY date DESC").bind(id).all();
        const { results: outreach } = await db.prepare("SELECT * FROM outreach_state WHERE prospect_id = ? ORDER BY step").bind(id).all();
        const { results: pilotLeads } = await db.prepare(
          `SELECT pl.*, l.name as lead_name, l.phone as lead_phone, l.score as lead_score, l.status as lead_status
           FROM pilot_leads pl JOIN leads l ON pl.lead_id = l.id WHERE pl.prospect_id = ? ORDER BY pl.lead_number`
        ).bind(id).all();
        return json({ ...prospect, activities, outreach, pilot_leads: pilotLeads });
      }
      if (path === "/prospects" && method === "POST") {
        const body = await request.json();
        const id = body.place_id || `p_${Date.now()}`;
        const existing = await db.prepare("SELECT id FROM prospects WHERE place_id = ?").bind(body.place_id || id).first();
        if (existing) return err("Prospect already exists", 409);
        await db.prepare(
          `INSERT INTO prospects (id, place_id, name, short_name, contact_name, email, phone, address, website, rating, reviews, notes, stage, score, vertical)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, body.place_id || id, body.name || "", body.short_name || "", body.contact_name || null, body.email || null, body.phone || body.formatted_phone_number || "", body.address || body.vicinity || "", body.website || null, body.rating || 0, body.reviews || body.user_ratings_total || 0, body.notes || "", body.stage || "prospect", body.score || 0, body.vertical || "dumpster").run();
        await db.prepare("INSERT INTO activities (prospect_id, type, note) VALUES (?, 'added', ?)").bind(id, "Added to CRM").run();
        const created = await db.prepare("SELECT * FROM prospects WHERE id = ?").bind(id).first();
        return json(created, 201);
      }
      if (matchPath(path, "/prospects/:id") && method === "PATCH") {
        const [id] = matchPath(path, "/prospects/:id");
        const body = await request.json();
        const allowed = ["name", "short_name", "contact_name", "email", "phone", "address", "website", "rating", "reviews", "notes", "stage", "score", "sequence", "sequence_step", "sequence_started", "last_contact", "pilot_status", "pilot_completed_date", "conversion_sequence_start", "operator_status", "default_zone", "vertical"];
        const sets = [];
        const vals = [];
        for (const key of allowed) {
          if (body[key] !== void 0) {
            sets.push(`${key} = ?`);
            vals.push(body[key]);
          }
        }
        if (!sets.length) return err("No valid fields to update");
        sets.push("updated_at = datetime('now')");
        vals.push(id);
        await db.prepare(`UPDATE prospects SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
        const updated = await db.prepare("SELECT * FROM prospects WHERE id = ?").bind(id).first();
        return json(updated);
      }
      if (matchPath(path, "/prospects/:id") && method === "DELETE") {
        const [id] = matchPath(path, "/prospects/:id");
        await db.prepare("DELETE FROM activities WHERE prospect_id = ?").bind(id).run();
        await db.prepare("DELETE FROM outreach_state WHERE prospect_id = ?").bind(id).run();
        await db.prepare("DELETE FROM prospects WHERE id = ?").bind(id).run();
        return json({ deleted: true });
      }
      if (matchPath(path, "/prospects/:id/enroll") && method === "POST") {
        const [id] = matchPath(path, "/prospects/:id/enroll");
        const body = await request.json();
        const sequenceId = body.sequence || "new_prospect";
        await db.prepare(
          `UPDATE prospects SET sequence = ?, sequence_step = 0, sequence_started = datetime('now'),
           stage = CASE WHEN stage = 'discovery' THEN 'prospect' ELSE stage END, updated_at = datetime('now') WHERE id = ?`
        ).bind(sequenceId, id).run();
        await db.prepare("INSERT INTO activities (prospect_id, type, note) VALUES (?, 'enrolled', ?)").bind(id, `Enrolled in ${sequenceId}`).run();
        const updated = await db.prepare("SELECT * FROM prospects WHERE id = ?").bind(id).first();
        return json(updated);
      }
      if (matchPath(path, "/prospects/:id/unenroll") && method === "POST") {
        const [id] = matchPath(path, "/prospects/:id/unenroll");
        await db.prepare(
          `UPDATE prospects SET sequence = NULL, sequence_step = 0, sequence_started = NULL, updated_at = datetime('now') WHERE id = ?`
        ).bind(id).run();
        await db.prepare("INSERT INTO activities (prospect_id, type, note) VALUES (?, 'unenroll', 'Removed from sequence')").bind(id).run();
        const updated = await db.prepare("SELECT * FROM prospects WHERE id = ?").bind(id).first();
        return json(updated);
      }
      if (matchPath(path, "/prospects/:id/advance") && method === "POST") {
        const [id] = matchPath(path, "/prospects/:id/advance");
        const body = await request.json();
        const note = body.note || "Step completed";
        const prospect = await db.prepare("SELECT * FROM prospects WHERE id = ?").bind(id).first();
        if (!prospect) return err("Not found", 404);
        const newStep = (prospect.sequence_step || 0) + 1;
        await db.prepare(
          `UPDATE prospects SET sequence_step = ?, last_contact = datetime('now'),
           stage = CASE WHEN stage = 'prospect' THEN 'contacted' ELSE stage END, updated_at = datetime('now') WHERE id = ?`
        ).bind(newStep, id).run();
        await db.prepare("INSERT INTO activities (prospect_id, type, note) VALUES (?, 'action', ?)").bind(id, note).run();
        const updated = await db.prepare("SELECT * FROM prospects WHERE id = ?").bind(id).first();
        return json(updated);
      }
      if (matchPath(path, "/prospects/:id/activities") && method === "GET") {
        const [id] = matchPath(path, "/prospects/:id/activities");
        const { results } = await db.prepare("SELECT * FROM activities WHERE prospect_id = ? ORDER BY date DESC").bind(id).all();
        return json({ activities: results });
      }
      if (matchPath(path, "/prospects/:id/activities") && method === "POST") {
        const [id] = matchPath(path, "/prospects/:id/activities");
        const body = await request.json();
        await db.prepare(
          "INSERT INTO activities (prospect_id, type, date, note, draft_subject, draft_body) VALUES (?, ?, COALESCE(?, datetime('now')), ?, ?, ?)"
        ).bind(id, body.type || "note", body.date || null, body.note || "", body.draft_subject || "", body.draft_body || "").run();
        return json({ success: true }, 201);
      }
      if (path === "/outreach-state" && method === "GET") {
        const prospectId = url.searchParams.get("prospect_id");
        let sql3 = "SELECT * FROM outreach_state";
        const params = [];
        if (prospectId) {
          sql3 += " WHERE prospect_id = ?";
          params.push(prospectId);
        }
        sql3 += " ORDER BY step";
        const { results } = await db.prepare(sql3).bind(...params).all();
        return json({ outreach: results });
      }
      if (path === "/outreach-state" && method === "POST") {
        const body = await request.json();
        const id = `${body.prospect_id}_step_${body.step}`;
        await db.prepare(
          `INSERT OR REPLACE INTO outreach_state (id, prospect_id, step, status, sent_at, type, recipient, reason)
           VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?)`
        ).bind(id, body.prospect_id, body.step, body.status, body.type || null, body.recipient || null, body.reason || null).run();
        return json({ success: true }, 201);
      }
      if (path === "/auth/check" && method === "GET") {
        return json({ ok: true });
      }
      if (path === "/outreach-log" && method === "GET") {
        await ensureOutreachSchema(db);
        const event = url.searchParams.get("event");
        const runId = url.searchParams.get("run_id");
        const day = url.searchParams.get("day");
        const since = url.searchParams.get("since");
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 1e3);
        const conds = [], vals = [];
        if (event) {
          conds.push("event = ?");
          vals.push(event);
        }
        if (runId) {
          conds.push("run_id = ?");
          vals.push(runId);
        }
        if (day) {
          conds.push("date(ts) = ?");
          vals.push(day);
        }
        if (since) {
          conds.push("ts >= ?");
          vals.push(since);
        }
        let sql3 = "SELECT * FROM outreach_log" + (conds.length ? " WHERE " + conds.join(" AND ") : "") + " ORDER BY id DESC LIMIT ?";
        vals.push(limit);
        const { results } = await db.prepare(sql3).bind(...vals).all();
        return json({ log: results || [], count: (results || []).length });
      }
      if (path === "/outreach-log" && method === "POST") {
        await ensureOutreachSchema(db);
        const body = await request.json();
        if (!body.event) return err("Required: event");
        const detail = body.detail == null ? null : typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
        const ins = await db.prepare(
          "INSERT INTO outreach_log (run_id, source, event, prospect_id, place_id, name, email, zone, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(body.run_id || null, body.source || "api", body.event, body.prospect_id || null, body.place_id || null, body.name || null, body.email || null, body.zone || null, detail).run();
        return json({ success: true, id: ins.meta?.last_row_id || null }, 201);
      }
      if (path === "/outreach-log/summary" && method === "GET") {
        await ensureOutreachSchema(db);
        const day = url.searchParams.get("day") || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        const { results: byEvent } = await db.prepare("SELECT event, COUNT(*) as c FROM outreach_log WHERE date(ts) = ? GROUP BY event ORDER BY c DESC").bind(day).all();
        const { results: reasons } = await db.prepare("SELECT COALESCE(json_extract(detail, '$.reason'), 'unspecified') as reason, COUNT(*) as c FROM outreach_log WHERE date(ts) = ? AND event = 'rejected' GROUP BY reason ORDER BY c DESC").bind(day).all();
        const { results: runs } = await db.prepare("SELECT run_id, MIN(ts) as started, MAX(ts) as ended, COUNT(*) as row_count FROM outreach_log WHERE date(ts) = ? AND run_id IS NOT NULL GROUP BY run_id ORDER BY started").bind(day).all();
        return json({ day, by_event: byEvent || [], rejection_reasons: reasons || [], runs: runs || [] });
      }
      if (path === "/suppression" && method === "GET") {
        await ensureOutreachSchema(db);
        const check = url.searchParams.get("email");
        if (check) {
          const email = check.trim().toLowerCase();
          const row = await db.prepare("SELECT * FROM suppression WHERE email = ?").bind(email).first();
          return json({ email, suppressed: !!row, entry: row || null });
        }
        const { results } = await db.prepare("SELECT * FROM suppression ORDER BY created_at DESC LIMIT 500").all();
        return json({ suppression: results || [], count: (results || []).length });
      }
      if (path === "/suppression" && method === "POST") {
        await ensureOutreachSchema(db);
        const body = await request.json();
        if (!body.email) return err("Required: email");
        const email = String(body.email).trim().toLowerCase();
        await db.prepare(
          "INSERT INTO suppression (email, reason, prospect_id) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET reason = excluded.reason, prospect_id = COALESCE(excluded.prospect_id, suppression.prospect_id)"
        ).bind(email, body.reason || "unsubscribed", body.prospect_id || null).run();
        return json({ success: true, email }, 201);
      }
      if (path === "/suppression" && method === "DELETE") {
        await ensureOutreachSchema(db);
        const email = url.searchParams.get("email");
        if (!email) return err("?email= required");
        await db.prepare("DELETE FROM suppression WHERE email = ?").bind(email.trim().toLowerCase()).run();
        return json({ success: true, removed: email.trim().toLowerCase() });
      }
      if (path === "/outreach-toggle" && method === "GET") {
        return json(await getOutreachToggle(db));
      }
      if (path === "/outreach-toggle" && method === "POST") {
        await ensureOutreachSchema(db);
        const body = await request.json();
        const paused = body.paused === true || body.paused === "true" || body.paused === 1;
        const t = { paused, reason: body.reason || null, updated_at: (/* @__PURE__ */ new Date()).toISOString(), updated_by: body.actor || "dashboard" };
        await db.prepare("INSERT OR REPLACE INTO data_store (key, value, updated_at) VALUES ('outreach_toggle', ?, datetime('now'))").bind(JSON.stringify(t)).run();
        await db.prepare("INSERT INTO outreach_log (source, event, detail) VALUES (?, 'toggle', ?)").bind(t.updated_by, JSON.stringify({ paused, reason: t.reason })).run();
        return json({ success: true, ...t });
      }
      if (path === "/zones/occupancy" && method === "GET") {
        const { results: ops } = await db.prepare("SELECT id, name, default_zone, operator_status, vertical FROM prospects WHERE operator_status IN ('active', 'pilot_active') AND default_zone IS NOT NULL").all();
        const { results: enrolledRows } = await db.prepare("SELECT default_zone, COUNT(*) as c FROM prospects WHERE sequence IS NOT NULL AND default_zone IS NOT NULL GROUP BY default_zone").all();
        const enrolledMap = {};
        for (const r of enrolledRows || []) enrolledMap[String(r.default_zone)] = r.c;
        const zones = Object.entries(ZONE_NAMES).map(([z, name]) => {
          const owners = (ops || []).filter((o) => String(o.default_zone) === z);
          const byVertical = {};
          for (const v of ["dumpster", "hauling"]) {
            const owner = owners.find((o) => (o.vertical || "dumpster") === v) || null;
            byVertical[v] = { open: !owner, operator: owner ? { id: owner.id, name: owner.name, status: owner.operator_status } : null };
          }
          return { zone: z, name, operators: owners.map((o) => ({ id: o.id, name: o.name, status: o.operator_status, vertical: o.vertical || "dumpster" })), by_vertical: byVertical, enrolled_prospects: enrolledMap[z] || 0 };
        });
        return json({ zones, zone_names: ZONE_NAMES });
      }
      if (path === "/due-actions" && method === "GET") {
        const { results } = await db.prepare(
          `SELECT p.*, (SELECT COUNT(*) FROM outreach_state os WHERE os.prospect_id = p.id AND os.step = p.sequence_step) as step_processed
           FROM prospects p WHERE p.sequence IS NOT NULL AND p.sequence_step >= 0 ORDER BY p.sequence_started`
        ).all();
        const due = results.filter((r) => r.step_processed === 0);
        return json({ due, count: due.length });
      }
      if (path === "/leads/analytics" && method === "GET") {
        const days = parseInt(url.searchParams.get("days") || "30", 10);
        const totalLeads = await db.prepare(`SELECT COUNT(*) as c FROM leads WHERE created_at >= datetime('now', '-${days} days')`).first();
        const byOutcome = await db.prepare(`SELECT outcome, COUNT(*) as c FROM leads WHERE created_at >= datetime('now', '-${days} days') GROUP BY outcome`).all();
        const bySource = await db.prepare(`SELECT source, COUNT(*) as c FROM leads WHERE created_at >= datetime('now', '-${days} days') GROUP BY source`).all();
        const byZone = await db.prepare(`SELECT zone, COUNT(*) as c FROM leads WHERE created_at >= datetime('now', '-${days} days') AND zone IS NOT NULL GROUP BY zone`).all();
        const byOperator = await db.prepare(`SELECT operator_name, COUNT(*) as total, SUM(CASE WHEN outcome = 'booked' THEN 1 ELSE 0 END) as booked, SUM(CASE WHEN outcome = 'completed' THEN 1 ELSE 0 END) as completed, SUM(COALESCE(revenue, 0)) as total_revenue, AVG(response_time_minutes) as avg_response_minutes FROM leads WHERE created_at >= datetime('now', '-${days} days') AND operator_name IS NOT NULL GROUP BY operator_name`).all();
        const byVertical = await db.prepare(`SELECT COALESCE(vertical, 'dumpster') as vertical, COUNT(*) as total, SUM(CASE WHEN outcome IN ('booked', 'completed') THEN 1 ELSE 0 END) as converted, SUM(COALESCE(revenue, 0)) as total_revenue FROM leads WHERE created_at >= datetime('now', '-${days} days') GROUP BY COALESCE(vertical, 'dumpster')`).all();
        const avgResponse = await db.prepare(`SELECT AVG(response_time_minutes) as avg_min FROM leads WHERE response_time_minutes IS NOT NULL AND created_at >= datetime('now', '-${days} days')`).first();
        const totalRevenue = await db.prepare(`SELECT SUM(revenue) as total FROM leads WHERE revenue IS NOT NULL AND created_at >= datetime('now', '-${days} days')`).first();
        const conversion = await db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN outcome IN ('booked', 'completed') THEN 1 ELSE 0 END) as converted FROM leads WHERE outcome != 'pending' AND created_at >= datetime('now', '-${days} days')`).first();
        return json({ period_days: days, total_leads: totalLeads.c, by_outcome: byOutcome.results, by_source: bySource.results, by_zone: byZone.results, by_operator: byOperator.results, by_vertical: byVertical.results, avg_response_time_minutes: avgResponse.avg_min, total_revenue: totalRevenue.total || 0, conversion_rate: conversion.total > 0 ? (conversion.converted / conversion.total * 100).toFixed(1) + "%" : "N/A", converted: conversion.converted || 0, resolved: conversion.total || 0 });
      }
      if (path === "/leads" && method === "GET") {
        const status = url.searchParams.get("status");
        const score = url.searchParams.get("score");
        const source = url.searchParams.get("source");
        const assignedTo = url.searchParams.get("assigned_to");
        const isPilot = url.searchParams.get("is_pilot");
        const outcome = url.searchParams.get("outcome");
        const zone = url.searchParams.get("zone");
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);
        let sql3 = "SELECT l.*, p.name as assigned_operator_name FROM leads l LEFT JOIN prospects p ON l.assigned_to = p.rowid";
        const params = [];
        const conditions = [];
        if (status) {
          conditions.push("l.status = ?");
          params.push(status);
        }
        if (score) {
          conditions.push("l.score = ?");
          params.push(score);
        }
        if (source) {
          conditions.push("l.source = ?");
          params.push(source);
        }
        if (assignedTo) {
          conditions.push("l.assigned_to = ?");
          params.push(assignedTo);
        }
        if (outcome) {
          conditions.push("l.outcome = ?");
          params.push(outcome);
        }
        if (zone) {
          conditions.push("l.zone = ?");
          params.push(zone);
        }
        if (isPilot === "true") conditions.push("l.is_pilot_lead = 1");
        if (isPilot === "false") conditions.push("(l.is_pilot_lead = 0 OR l.is_pilot_lead IS NULL)");
        if (conditions.length) sql3 += " WHERE " + conditions.join(" AND ");
        sql3 += " ORDER BY l.created_at DESC LIMIT ? OFFSET ?";
        params.push(limit, offset);
        const { results } = await db.prepare(sql3).bind(...params).all();
        const totalCount = await db.prepare("SELECT COUNT(*) as c FROM leads").first();
        return json({ leads: results, count: results.length, total: totalCount.c });
      }
      if (path === "/leads" && method === "POST") {
        const body = await request.json();
        const score = body.score || scoreLead(body.timeline, body.project_type);
        const cityVal = body.zip_code || body.city || null;
        const zone = body.zone || detectZone(cityVal || "");
        let assignedTo = body.assigned_to || null;
        let operatorName = null;
        if (assignedTo) {
          const op = await db.prepare("SELECT name FROM prospects WHERE id = ?").bind(assignedTo).first();
          if (op) operatorName = op.name;
        }
        const result = await db.prepare(
          `INSERT INTO leads (source, lead_source_detail, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid,
           name, phone, email, project_type, dumpster_size, timeline, debris_type, notes, score,
           assigned_to, operator_name, operator_prospect_id, status, is_pilot_lead, pilot_lead_number,
           zone, city, operator_notified_at, outcome, assigned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${assignedTo ? "datetime('now')" : "NULL"}, 'pending', ${assignedTo ? "datetime('now')" : "NULL"})`
        ).bind(
          body.source || "manual",
          body.lead_source_detail || null,
          body.utm_source || null,
          body.utm_medium || null,
          body.utm_campaign || null,
          body.utm_content || null,
          body.utm_term || null,
          body.gclid || null,
          body.name || null,
          body.phone || null,
          body.email || null,
          body.project_type || null,
          body.dumpster_size || null,
          body.timeline || null,
          body.debris_type || null,
          body.notes || null,
          score,
          assignedTo,
          operatorName,
          assignedTo,
          body.status || "new",
          body.is_pilot_lead ? 1 : 0,
          body.pilot_lead_number || null,
          zone,
          cityVal
        ).run();
        const leadId = result.meta.last_row_id;
        await logLeadEvent(db, leadId, "created", { source: body.source || "manual", score, zone, city: cityVal, operator: operatorName }, "system");
        if (assignedTo) {
          await db.prepare("INSERT INTO activities (prospect_id, type, note) VALUES (?, 'lead_received', ?)").bind(assignedTo, `[lead_${leadId}] New ${score} lead from ${body.source || "manual"}: ${body.name || "Unknown"} \u2014 ${body.project_type || "N/A"}`).run();
          await logLeadEvent(db, leadId, "assigned", { operator: operatorName, operator_id: assignedTo }, "system");
        }
        await notifyOwner(env, db, { name: body.name, phone: body.phone, city: cityVal, zone, project_type: body.project_type, score, source: body.source || "manual" }, leadId);
        const created = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(leadId).first();
        return json(created, 201);
      }
      if (matchPath(path, "/leads/:id/outcome") && method === "PATCH") {
        const [id] = matchPath(path, "/leads/:id/outcome");
        const body = await request.json();
        if (!body.outcome) return err("outcome is required");
        const sets = ["outcome = ?", "outcome_at = datetime('now')"];
        const vals = [body.outcome];
        if (body.revenue !== void 0) {
          sets.push("revenue = ?");
          vals.push(body.revenue);
        }
        if (body.lost_reason) {
          sets.push("lost_reason = ?");
          vals.push(body.lost_reason);
        }
        if (body.outcome === "completed") sets.push("job_completed_at = datetime('now')");
        if (body.outcome === "booked") sets.push("status = 'booked'");
        if (["no_answer", "not_interested", "wrong_number", "out_of_area", "too_expensive", "lost_other"].includes(body.outcome)) sets.push("status = 'closed'");
        vals.push(id);
        await db.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
        await logLeadEvent(db, id, "outcome_set", { outcome: body.outcome, revenue: body.revenue || null, lost_reason: body.lost_reason || null }, body.actor || "charlie");
        const lead = await db.prepare("SELECT assigned_to, name FROM leads WHERE id = ?").bind(id).first();
        if (lead && lead.assigned_to) {
          await db.prepare("INSERT INTO activities (prospect_id, type, note) VALUES (?, 'lead_outcome', ?)").bind(lead.assigned_to, `[lead_${id}] ${lead.name || "Lead"} \u2192 ${body.outcome}${body.revenue ? " ($" + body.revenue + ")" : ""}`).run();
        }
        const updated = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first();
        return json(updated);
      }
      if (matchPath(path, "/leads/:id/operator-responded") && method === "POST") {
        const [id] = matchPath(path, "/leads/:id/operator-responded");
        const body = await request.json();
        const respondedAt = body.responded_at || (/* @__PURE__ */ new Date()).toISOString();
        await db.prepare("UPDATE leads SET operator_responded_at = ?, customer_contacted_at = ? WHERE id = ?").bind(respondedAt, respondedAt, id).run();
        const lead = await db.prepare("SELECT operator_notified_at FROM leads WHERE id = ?").bind(id).first();
        if (lead && lead.operator_notified_at) {
          const diffMinutes = Math.round((new Date(respondedAt) - new Date(lead.operator_notified_at)) / 6e4);
          await db.prepare("UPDATE leads SET response_time_minutes = ? WHERE id = ?").bind(diffMinutes, id).run();
          await logLeadEvent(db, id, "operator_responded", { response_time_minutes: diffMinutes, responded_at: respondedAt }, "system");
        }
        const updated = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first();
        return json(updated);
      }
      if (matchPath(path, "/leads/:id/events") && method === "GET") {
        const [id] = matchPath(path, "/leads/:id/events");
        const { results } = await db.prepare("SELECT * FROM lead_events WHERE lead_id = ? ORDER BY created_at DESC").bind(id).all();
        return json({ events: results, count: results.length });
      }
      if (matchPath(path, "/leads/:id/assign") && method === "POST") {
        const [id] = matchPath(path, "/leads/:id/assign");
        const body = await request.json();
        if (!body.prospect_id) return err("prospect_id is required");
        const op = await db.prepare("SELECT name, vertical FROM prospects WHERE id = ?").bind(body.prospect_id).first();
        const opVertical = op && op.vertical ? op.vertical : "dumpster";
        await db.prepare("UPDATE leads SET assigned_to = ?, operator_name = ?, operator_prospect_id = ?, vertical = ?, assigned_at = datetime('now'), operator_notified_at = datetime('now') WHERE id = ?").bind(body.prospect_id, op ? op.name : null, body.prospect_id, opVertical, id).run();
        await db.prepare("INSERT INTO activities (prospect_id, type, note) VALUES (?, 'lead_assigned', ?)").bind(body.prospect_id, `[lead_${id}] Lead assigned`).run();
        await logLeadEvent(db, id, "assigned", { operator: op ? op.name : null, operator_id: body.prospect_id }, body.actor || "api");
        const updated = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first();
        return json(updated);
      }
      if (matchPath(path, "/leads/:id") && method === "GET") {
        const [id] = matchPath(path, "/leads/:id");
        const lead = await db.prepare("SELECT l.*, p.name as assigned_operator_name FROM leads l LEFT JOIN prospects p ON CAST(l.assigned_to AS TEXT) = p.id WHERE l.id = ?").bind(id).first();
        if (!lead) return err("Lead not found", 404);
        const { results: events } = await db.prepare("SELECT * FROM lead_events WHERE lead_id = ? ORDER BY created_at DESC").bind(id).all();
        const { results: activities } = await db.prepare("SELECT * FROM activities WHERE note LIKE ? ORDER BY date DESC").bind(`%lead_${id}%`).all();
        return json({ ...lead, events, activities });
      }
      if (matchPath(path, "/leads/:id") && method === "PATCH") {
        const [id] = matchPath(path, "/leads/:id");
        const body = await request.json();
        const allowed = ["name", "phone", "email", "project_type", "dumpster_size", "timeline", "debris_type", "vertical", "notes", "score", "assigned_to", "status", "is_pilot_lead", "pilot_lead_number", "outcome_at", "lead_source_detail", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "zone", "city", "operator_notified_at", "operator_responded_at", "response_time_minutes", "outcome", "revenue", "lost_reason", "operator_name", "operator_prospect_id", "job_completed_at", "customer_contacted_at"];
        const sets = [];
        const vals = [];
        for (const key of allowed) {
          if (body[key] !== void 0) {
            sets.push(`${key} = ?`);
            vals.push(body[key]);
          }
        }
        if (!sets.length) return err("No valid fields to update");
        if (body.assigned_to !== void 0) sets.push("assigned_at = datetime('now')");
        vals.push(id);
        await db.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
        if (body.outcome) {
          await logLeadEvent(db, id, "outcome_changed", { outcome: body.outcome, revenue: body.revenue, lost_reason: body.lost_reason }, body.actor || "api");
          await db.prepare("UPDATE leads SET outcome_at = datetime('now') WHERE id = ?").bind(id).run();
        }
        if (body.operator_responded_at) {
          const lead = await db.prepare("SELECT operator_notified_at FROM leads WHERE id = ?").bind(id).first();
          if (lead && lead.operator_notified_at) {
            const diffMinutes = Math.round((new Date(body.operator_responded_at) - new Date(lead.operator_notified_at)) / 6e4);
            await db.prepare("UPDATE leads SET response_time_minutes = ? WHERE id = ?").bind(diffMinutes, id).run();
            await logLeadEvent(db, id, "operator_responded", { response_time_minutes: diffMinutes }, "system");
          }
        }
        if (body.status) {
          const lead = await db.prepare("SELECT assigned_to FROM leads WHERE id = ?").bind(id).first();
          if (lead && lead.assigned_to) {
            await db.prepare("INSERT INTO activities (prospect_id, type, note) VALUES (?, 'lead_update', ?)").bind(lead.assigned_to, `[lead_${id}] Status \u2192 ${body.status}`).run();
          }
          await logLeadEvent(db, id, "status_changed", { status: body.status }, body.actor || "api");
        }
        if (body.assigned_to) {
          await logLeadEvent(db, id, "reassigned", { operator_id: body.assigned_to, operator_name: body.operator_name }, body.actor || "api");
        }
        const updated = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(id).first();
        return json(updated);
      }
      if (matchPath(path, "/leads/:id") && method === "DELETE") {
        const [id] = matchPath(path, "/leads/:id");
        await db.prepare("DELETE FROM lead_events WHERE lead_id = ?").bind(id).run();
        await db.prepare("DELETE FROM pilot_leads WHERE lead_id = ?").bind(id).run();
        await db.prepare("DELETE FROM leads WHERE id = ?").bind(id).run();
        return json({ deleted: true });
      }
      if (path === "/stats" && method === "GET") {
        const total = await db.prepare("SELECT COUNT(*) as c FROM prospects").first();
        const byStage = await db.prepare("SELECT stage, COUNT(*) as c FROM prospects GROUP BY stage").all();
        const enrolled = await db.prepare("SELECT COUNT(*) as c FROM prospects WHERE sequence IS NOT NULL").first();
        const withEmail = await db.prepare("SELECT COUNT(*) as c FROM prospects WHERE email IS NOT NULL").first();
        const totalLeads = await db.prepare("SELECT COUNT(*) as c FROM leads").first();
        const leadsByScore = await db.prepare("SELECT score, COUNT(*) as c FROM leads GROUP BY score").all();
        const leadsByStatus = await db.prepare("SELECT status, COUNT(*) as c FROM leads GROUP BY status").all();
        const leadsBySource = await db.prepare("SELECT source, COUNT(*) as c FROM leads GROUP BY source").all();
        const leadsByOutcome = await db.prepare("SELECT outcome, COUNT(*) as c FROM leads GROUP BY outcome").all();
        const leadsByZone = await db.prepare("SELECT zone, COUNT(*) as c FROM leads WHERE zone IS NOT NULL GROUP BY zone").all();
        const pilotsActive = await db.prepare("SELECT COUNT(*) as c FROM prospects WHERE pilot_status = 'in_progress'").first();
        const operators = await db.prepare("SELECT COUNT(*) as c FROM prospects WHERE operator_status IN ('active', 'pilot_active')").first();
        const spamBlocked = await db.prepare("SELECT COUNT(*) as c FROM leads WHERE status = 'spam'").first();
        const totalRevenue = await db.prepare("SELECT SUM(revenue) as total FROM leads WHERE revenue IS NOT NULL").first();
        const avgResponse = await db.prepare("SELECT AVG(response_time_minutes) as avg_min FROM leads WHERE response_time_minutes IS NOT NULL").first();
        return json({ total_prospects: total.c, prospects_by_stage: byStage.results, enrolled: enrolled.c, with_email: withEmail.c, total_leads: totalLeads.c, leads_by_score: leadsByScore.results, leads_by_status: leadsByStatus.results, leads_by_source: leadsBySource.results, leads_by_outcome: leadsByOutcome.results, leads_by_zone: leadsByZone.results, active_pilots: pilotsActive.c, active_operators: operators.c, spam_blocked: spamBlocked.c, total_revenue: totalRevenue.total || 0, avg_response_time_minutes: avgResponse.avg_min });
      }
      if (path === "/pilot-leads" && method === "GET") {
        const prospectId = url.searchParams.get("prospect_id");
        let sql3 = `SELECT pl.*, l.name as lead_name, l.phone as lead_phone, l.score as lead_score, l.status as lead_status, l.source as lead_source, p.name as operator_name FROM pilot_leads pl JOIN leads l ON pl.lead_id = l.id JOIN prospects p ON pl.prospect_id = p.id`;
        const params = [];
        if (prospectId) {
          sql3 += " WHERE pl.prospect_id = ?";
          params.push(prospectId);
        }
        sql3 += " ORDER BY pl.date_sent DESC";
        const { results } = await db.prepare(sql3).bind(...params).all();
        return json({ pilot_leads: results, count: results.length });
      }
      if (path === "/pilot-leads" && method === "POST") {
        const body = await request.json();
        if (!body.prospect_id || !body.lead_id || !body.lead_number) return err("prospect_id, lead_id, and lead_number are required");
        await db.prepare(`INSERT INTO pilot_leads (prospect_id, lead_id, lead_number, date_sent, outcome, notes) VALUES (?, ?, ?, COALESCE(?, datetime('now')), ?, ?)`).bind(body.prospect_id, body.lead_id, body.lead_number, body.date_sent || null, body.outcome || "pending", body.notes || null).run();
        await db.prepare("UPDATE leads SET is_pilot_lead = 1, pilot_lead_number = ? WHERE id = ?").bind(body.lead_number, body.lead_id).run();
        if (body.lead_number === 1) {
          await db.prepare("UPDATE prospects SET pilot_status = 'in_progress', updated_at = datetime('now') WHERE id = ?").bind(body.prospect_id).run();
        }
        await db.prepare("INSERT INTO activities (prospect_id, type, note) VALUES (?, 'pilot_lead', ?)").bind(body.prospect_id, `[lead_${body.lead_id}] Pilot lead #${body.lead_number} sent`).run();
        return json({ success: true }, 201);
      }
      if (matchPath(path, "/pilot-leads/:id") && method === "PATCH") {
        const [id] = matchPath(path, "/pilot-leads/:id");
        const body = await request.json();
        const allowed = ["outcome", "notes"];
        const sets = [];
        const vals = [];
        for (const key of allowed) {
          if (body[key] !== void 0) {
            sets.push(`${key} = ?`);
            vals.push(body[key]);
          }
        }
        if (!sets.length) return err("No valid fields to update");
        vals.push(id);
        await db.prepare(`UPDATE pilot_leads SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
        const pilotLead = await db.prepare("SELECT * FROM pilot_leads WHERE id = ?").bind(id).first();
        if (pilotLead) {
          const { results: allPilots } = await db.prepare("SELECT * FROM pilot_leads WHERE prospect_id = ?").bind(pilotLead.prospect_id).all();
          const allResolved = allPilots.length >= 2 && allPilots.every((pl) => pl.outcome !== "pending");
          if (allResolved) {
            await db.prepare("UPDATE prospects SET pilot_status = 'completed', pilot_completed_date = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(pilotLead.prospect_id).run();
            await db.prepare("INSERT INTO activities (prospect_id, type, note) VALUES (?, 'pilot_complete', 'Both pilot leads resolved \u2014 ready for conversion evaluation')").bind(pilotLead.prospect_id).run();
          }
        }
        const updated = await db.prepare("SELECT * FROM pilot_leads WHERE id = ?").bind(id).first();
        return json(updated);
      }
      if (path === "/actions" && method === "GET") {
        await db.prepare(`CREATE TABLE IF NOT EXISTS dashboard_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          section TEXT NOT NULL,
          action_text TEXT NOT NULL,
          status TEXT DEFAULT 'open',
          created_at TEXT DEFAULT (datetime('now')),
          completed_at TEXT,
          dismissed_at TEXT,
          auto_generated INTEGER DEFAULT 1
        )`).run();
        const status = url.searchParams.get("status") || "open";
        const section = url.searchParams.get("section");
        let sql3 = "SELECT * FROM dashboard_actions WHERE status = ?";
        const params = [status];
        if (section) {
          sql3 += " AND section = ?";
          params.push(section);
        }
        sql3 += " ORDER BY created_at DESC LIMIT 50";
        const { results } = await db.prepare(sql3).bind(...params).all();
        return json({ actions: results, count: results.length });
      }
      if (path === "/actions" && method === "POST") {
        await db.prepare(`CREATE TABLE IF NOT EXISTS dashboard_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          section TEXT NOT NULL,
          action_text TEXT NOT NULL,
          status TEXT DEFAULT 'open',
          created_at TEXT DEFAULT (datetime('now')),
          completed_at TEXT,
          dismissed_at TEXT,
          auto_generated INTEGER DEFAULT 1
        )`).run();
        const body = await request.json();
        if (!body.section || !body.action_text) return err("section and action_text required");
        const existing = await db.prepare(
          "SELECT id FROM dashboard_actions WHERE section = ? AND action_text = ? AND status = 'open'"
        ).bind(body.section, body.action_text).first();
        if (existing) return json({ success: true, action_id: existing.id, deduplicated: true });
        const result = await db.prepare(
          "INSERT INTO dashboard_actions (section, action_text, auto_generated) VALUES (?, ?, ?)"
        ).bind(body.section, body.action_text, body.auto_generated ?? 1).run();
        return json({ success: true, action_id: result.meta.last_row_id }, 201);
      }
      if (matchPath(path, "/actions/:id") && method === "PATCH") {
        const [id] = matchPath(path, "/actions/:id");
        const body = await request.json();
        if (body.status === "completed") {
          await db.prepare("UPDATE dashboard_actions SET status = 'completed', completed_at = datetime('now') WHERE id = ?").bind(id).run();
        } else if (body.status === "dismissed") {
          await db.prepare("UPDATE dashboard_actions SET status = 'dismissed', dismissed_at = datetime('now') WHERE id = ?").bind(id).run();
        } else {
          return err("status must be 'completed' or 'dismissed'");
        }
        const updated = await db.prepare("SELECT * FROM dashboard_actions WHERE id = ?").bind(id).first();
        return json(updated);
      }
      if (path === "/actions" && method === "DELETE") {
        const before = url.searchParams.get("before");
        if (!before) return err("?before=YYYY-MM-DD required");
        await db.prepare("DELETE FROM dashboard_actions WHERE status != 'open' AND created_at < ?").bind(before).run();
        return json({ success: true, message: "Cleared completed/dismissed actions before " + before });
      }
      if (path === "/financials" && method === "GET") {
        const row = await db.prepare("SELECT * FROM financials ORDER BY snapshot_date DESC LIMIT 1").first();
        if (!row) return err("No financial data yet", 404);
        return json(row);
      }
      if (path === "/financials" && method === "POST") {
        const body = await request.json();
        if (!body.snapshot_date) return err("snapshot_date required");
        await db.prepare(
          "INSERT OR REPLACE INTO financials (snapshot_date, revenue, total_invested, google_ads_spend, twilio_spend, other_spend, total_spend, cash_on_hand, cashback_earned, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
        ).bind(
          body.snapshot_date,
          body.revenue ?? 0,
          body.total_invested ?? 0,
          body.google_ads_spend ?? 0,
          body.twilio_spend ?? 0,
          body.other_spend ?? 0,
          body.total_spend ?? 0,
          body.cash_on_hand ?? 0,
          body.cashback_earned ?? 0,
          body.notes || null
        ).run();
        return json({ success: true, message: "Financial snapshot saved" }, 201);
      }
      if (path === "/financials/history" && method === "GET") {
        const limit2 = parseInt(url.searchParams.get("limit") || "30", 10);
        const { results: snapResults } = await db.prepare("SELECT * FROM financials ORDER BY snapshot_date DESC LIMIT ?").bind(limit2).all();
        return json({ snapshots: snapResults, count: snapResults.length });
      }
      return err("Not found", 404);
    } catch (e) {
      console.error("CRM API Error:", e);
      return err(e.message || "Internal error", 500);
    }
  },
  async scheduled(event, env, ctx) {
    console.log("Cron triggered:", event.cron, "at", (/* @__PURE__ */ new Date()).toISOString());
    ctx.waitUntil(handleSeoSnapshot(env));
  }
};
var ENFORCE_MERCURY_SIG = false;
async function hmacHexSHA256(keyBytes, message) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmacHexSHA256, "hmacHexSHA256");
__name2(hmacHexSHA256, "hmacHexSHA256");
async function verifyMercuryHmac(raw, headers, secret) {
  if (!secret) return "no_secret";
  const sig = headers["mercury-signature"] || headers["x-mercury-signature"] || null;
  if (!sig) return "no_sig_header";
  const parts = Object.fromEntries(
    sig.split(",").map((kv) => kv.split("=").map((s) => s.trim())).filter((a) => a.length === 2)
  );
  const t = parts.t;
  const v1 = (parts.v1 || "").toLowerCase();
  if (!t || !v1) return "bad_sig_format";
  const signed = `${t}.${raw}`;
  try {
    if (await hmacHexSHA256(new TextEncoder().encode(secret), signed) === v1) return "match";
    try {
      const bin = atob(secret);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (await hmacHexSHA256(bytes, signed) === v1) return "match";
    } catch (_) {
    }
    return "mismatch";
  } catch (e) {
    return "error";
  }
}
__name(verifyMercuryHmac, "verifyMercuryHmac");
__name2(verifyMercuryHmac, "verifyMercuryHmac");
async function updateCashOnHand(db, cash) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const existing = await db.prepare("SELECT id FROM financials WHERE snapshot_date = ?").bind(today).first();
  if (existing) {
    await db.prepare("UPDATE financials SET cash_on_hand = ?, updated_at = datetime('now') WHERE id = ?").bind(cash, existing.id).run();
    return;
  }
  const last = await db.prepare("SELECT * FROM financials ORDER BY snapshot_date DESC LIMIT 1").first() || {};
  await db.prepare(
    "INSERT INTO financials (snapshot_date, revenue, total_invested, google_ads_spend, twilio_spend, other_spend, total_spend, cash_on_hand, cashback_earned, notes, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))"
  ).bind(
    today,
    last.revenue ?? 0,
    last.total_invested ?? 0,
    last.google_ads_spend ?? 0,
    last.twilio_spend ?? 0,
    last.other_spend ?? 0,
    last.total_spend ?? 0,
    cash,
    last.cashback_earned ?? 0,
    last.notes || null
  ).run();
}
__name(updateCashOnHand, "updateCashOnHand");
__name2(updateCashOnHand, "updateCashOnHand");
async function handleMercuryWebhook(request, db, env) {
  if (request.method === "GET") return json({ ok: true });
  try {
    const raw = await request.text();
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch (_) {
      body = {};
    }
    const headers = {};
    for (const [k, v] of request.headers) headers[k] = v;
    const verify = await verifyMercuryHmac(raw, headers, env.MERCURY_WEBHOOK_SECRET);
    if (ENFORCE_MERCURY_SIG && verify === "mismatch") return err("Invalid signature", 401);
    const resourceType = body.resourceType || null;
    const resourceId = body.resourceId || null;
    const op = body.operationType || null;
    const patch = body.mergePatch || {};
    const availBal = patch.availableBalance ?? null;
    const currBal = patch.currentBalance ?? null;
    const eventType = resourceType && op ? `${resourceType}.${op}` : body.eventType || null;
    const changed = Array.isArray(body.changedPaths) ? body.changedPaths.join(",") : null;
    const newBal = availBal ?? currBal;
    let cash = null;
    try {
      await db.prepare("CREATE TABLE IF NOT EXISTS mercury_accounts (resource_id TEXT PRIMARY KEY, resource_type TEXT, available_balance REAL, current_balance REAL, updated_at TEXT)").run();
      if (resourceId && (availBal !== null || currBal !== null)) {
        await db.prepare(
          "INSERT INTO mercury_accounts (resource_id, resource_type, available_balance, current_balance, updated_at) VALUES (?,?,?,?,datetime('now')) ON CONFLICT(resource_id) DO UPDATE SET resource_type=excluded.resource_type, available_balance=COALESCE(excluded.available_balance, mercury_accounts.available_balance), current_balance=COALESCE(excluded.current_balance, mercury_accounts.current_balance), updated_at=datetime('now')"
        ).bind(resourceId, resourceType, availBal, currBal).run();
        const row = await db.prepare("SELECT COALESCE(SUM(available_balance),0) AS cash FROM mercury_accounts WHERE resource_type IN ('checkingAccount','savingsAccount')").first();
        cash = row ? row.cash : null;
        if (typeof cash === "number") await updateCashOnHand(db, cash);
      }
    } catch (e) {
      console.error("mercury balance sync failed:", e);
    }
    const envelope = JSON.stringify({ verify, cash_on_hand: cash, headers, body });
    try {
      await db.prepare("CREATE TABLE IF NOT EXISTS mercury_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT, amount REAL, description TEXT, raw TEXT, received_at TEXT DEFAULT (datetime('now')))").run();
      await db.prepare("INSERT INTO mercury_events (event_type, amount, description, raw) VALUES (?, ?, ?, ?)").bind(eventType, typeof newBal === "number" ? newBal : null, changed, envelope).run();
    } catch (e) {
      console.error("mercury_events insert failed:", e);
    }
    return json({ received: true });
  } catch (e) {
    console.error("Mercury webhook error:", e);
    return json({ received: true });
  }
}
__name(handleMercuryWebhook, "handleMercuryWebhook");
__name2(handleMercuryWebhook, "handleMercuryWebhook");
async function handleTwilioInbound(request, db, env) {
  try {
    const form = await request.formData();
    const from = (form.get("From") || "").replace(/\D/g, "");
    const body = (form.get("Body") || "").trim().toUpperCase();
    if (!AUTHORIZED_SMS.some((n) => n.replace(/\D/g, "") === from)) {
      console.warn(`Unauthorized SMS from ${from}`);
      return twiml("Not authorized.");
    }
    const parts = body.split(/\s+/);
    const cmd = parts[0];
    const leadId = parseInt(parts[1], 10);
    if (!leadId || isNaN(leadId)) return twiml("Format: RESPONDED 42 | BOOKED 42 | DONE 42 [revenue] | LOST 42");
    const lead = await db.prepare("SELECT * FROM leads WHERE id = ?").bind(leadId).first();
    if (!lead) return twiml(`Lead #${leadId} not found.`);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (cmd === "RESPONDED") {
      await db.prepare("UPDATE leads SET operator_responded_at = ?, customer_contacted_at = ? WHERE id = ?").bind(now, now, leadId).run();
      if (lead.operator_notified_at) {
        const diffMin = Math.round((new Date(now) - new Date(lead.operator_notified_at)) / 6e4);
        await db.prepare("UPDATE leads SET response_time_minutes = ? WHERE id = ?").bind(diffMin, leadId).run();
        await logLeadEvent(db, leadId, "operator_responded", { response_time_minutes: diffMin, via: "sms_command" }, "charlie");
        return twiml(`Lead #${leadId} marked responded. Response time: ${diffMin} min.`);
      }
      await logLeadEvent(db, leadId, "operator_responded", { via: "sms_command" }, "charlie");
      return twiml(`Lead #${leadId} marked responded.`);
    }
    if (cmd === "BOOKED") {
      await db.prepare("UPDATE leads SET outcome = 'booked', outcome_at = ?, status = 'booked' WHERE id = ?").bind(now, leadId).run();
      await logLeadEvent(db, leadId, "outcome_set", { outcome: "booked", via: "sms_command" }, "charlie");
      if (lead.assigned_to) {
        await db.prepare("INSERT INTO activities (prospect_id, type, note) VALUES (?, 'lead_outcome', ?)").bind(lead.assigned_to, `[lead_${leadId}] ${lead.name || "Lead"} \u2192 booked`).run();
      }
      return twiml(`Lead #${leadId} marked BOOKED. Nice work.`);
    }
    if (cmd === "DONE") {
      const revenue = parts[2] ? parseFloat(parts[2].replace(/[^0-9.]/g, "")) : null;
      const sets = ["outcome = 'completed'", "outcome_at = ?", "job_completed_at = ?", "status = 'closed'"];
      const vals = [now, now];
      if (revenue) {
        sets.push("revenue = ?");
        vals.push(revenue);
      }
      vals.push(leadId);
      await db.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
      await logLeadEvent(db, leadId, "outcome_set", { outcome: "completed", revenue, via: "sms_command" }, "charlie");
      if (lead.assigned_to) {
        await db.prepare("INSERT INTO activities (prospect_id, type, note) VALUES (?, 'lead_outcome', ?)").bind(lead.assigned_to, `[lead_${leadId}] ${lead.name || "Lead"} \u2192 completed${revenue ? " ($" + revenue + ")" : ""}`).run();
      }
      return twiml(`Lead #${leadId} marked DONE${revenue ? " \xB7 $" + revenue : ""}. Logged.`);
    }
    if (cmd === "LOST") {
      await db.prepare("UPDATE leads SET outcome = 'lost_other', outcome_at = ?, status = 'closed' WHERE id = ?").bind(now, leadId).run();
      await logLeadEvent(db, leadId, "outcome_set", { outcome: "lost_other", via: "sms_command" }, "charlie");
      return twiml(`Lead #${leadId} marked LOST.`);
    }
    return twiml("Unknown command. Try: RESPONDED 42 | BOOKED 42 | DONE 42 [revenue] | LOST 42");
  } catch (e) {
    console.error("Twilio inbound error:", e);
    return twiml("Error processing command. Try again.");
  }
}
__name(handleTwilioInbound, "handleTwilioInbound");
__name2(handleTwilioInbound, "handleTwilioInbound");
__name22(handleTwilioInbound, "handleTwilioInbound");
async function handleFormSubmission(request, db, env) {
  try {
    let body;
    const contentType = request.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) body = await request.json();
    else if (contentType.includes("form")) {
      const fd = await request.formData();
      body = Object.fromEntries(fd.entries());
    } else return err("Unsupported content type", 415);
    if (!body.name && !body.phone && !body.email) return err("At least name, phone, or email is required");
    const score = scoreLead(body.timeline, body.project_type);
    const cityVal = body.zip_code || body.city || null;
    const zone = body.zone || detectZone(cityVal || "");
    const result = await db.prepare(
      `INSERT INTO leads (source, lead_source_detail, utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid,
       name, phone, email, project_type, dumpster_size, timeline, debris_type, notes, score,
       assigned_to, operator_name, operator_prospect_id, status, zone, city, operator_notified_at, outcome, assigned_at)
       VALUES ('website_form', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'new', ?, ?, NULL, 'pending', NULL)`
    ).bind(
      body.lead_source_detail || "website_form",
      body.utm_source || null,
      body.utm_medium || null,
      body.utm_campaign || null,
      body.utm_content || null,
      body.utm_term || null,
      body.gclid || null,
      body.name || null,
      body.phone || null,
      body.email || null,
      body.project_type || null,
      body.dumpster_size || null,
      body.timeline || null,
      body.debris_type || null,
      body.notes || body.message || null,
      score,
      zone,
      cityVal
    ).run();
    const leadId = result.meta.last_row_id;
    await logLeadEvent(db, leadId, "created", { source: "website_form", score, zone, city: cityVal }, "system");
    await notifyOwner(env, db, { name: body.name, phone: body.phone, city: cityVal, zone, project_type: body.project_type, score, source: "website_form" }, leadId);
    const consent = consentGiven(body);
    if (consent) await logLeadEvent(db, leadId, "sms_consent", { source: "website_form", channel: "sms", consent_text: "lead form checkbox" }, "customer");
    await sendCustomerSMS(env, { name: body.name, phone: body.phone, service: body.project_type || body.dumpster_size, city: body.city || cityVal, source: "website_form", consent }, leadId);
    return json({ success: true, lead_id: leadId, score, zone, city: cityVal, assigned_to: null, operator_name: null, message: "Thank you! We will connect you with a local dumpster rental provider shortly." }, 201);
  } catch (e) {
    console.error("Form submission error:", e);
    return err("Failed to process submission", 500);
  }
}
__name(handleFormSubmission, "handleFormSubmission");
__name2(handleFormSubmission, "handleFormSubmission");
__name22(handleFormSubmission, "handleFormSubmission");
async function handleCallRailWebhook(request, db, env) {
  try {
    const body = await request.json();
    const callId = body.id || body.call_id || body.resource_id || null;
    const duration = body.duration || body.total_duration || 0;
    const callerName = body.caller_name || body.customer_name || null;
    const callerPhone = body.caller_number || body.customer_phone_number || null;
    const extracted = extractCallRailFields(body);
    const projectType = extracted.service;
    const cityStore = extracted.location || body.caller_city || body.city || null;
    const zone = detectZone(extracted.zip || extracted.city || body.caller_city || body.city || "");
    const score = scoreCall(duration);
    // Voice Assist intake is the authoritative "real lead" signal: a captured
    // service/name means a person actually spoke to the AI assistant, no matter
    // how short the call was. Robocall recordings that Voice Assist talks over
    // come in with a padded duration but no coherent intake, so call length
    // alone can't tell them apart (a 41s voicemail once passed the old filter
    // and created a junk lead). Keep any call with real intake regardless of
    // length; for calls with NO intake, fall back to the short-call filter and
    // also drop voicemail/unanswered. When Voice Assist is off (no trial) no
    // intake is ever present, so this reduces to the original duration filter.
    const va = body.voice_assist_message || {};
    const vaContents = va.ordered_content_with_overrides || va.contents || {};
    const hasVoiceAssistIntake = !!(pickFirst(vaContents.product_service_interest, vaContents.name, vaContents.purpose) || extracted.service);
    const isVoicemail = body.call_type === "voicemail" || body.answered === false;
    if (!hasVoiceAssistIntake && (isVoicemail || duration < SPAM_MIN_DURATION)) {
      const reason = isVoicemail ? "no_intake_voicemail" : "spam_short_call";
      console.log(`Spam filtered: call_id=${callId} duration=${duration}s answered=${body.answered} intake=false reason=${reason}`);
      return json({ success: true, filtered: true, reason, duration });
    }
    if (callId) {
      const existing = await db.prepare("SELECT id FROM leads WHERE callrail_call_id = ?").bind(String(callId)).first();
      if (existing) return json({ success: true, duplicate: true, lead_id: existing.id });
    }
    const sourceDetail = body.tracking_phone_number || body.source || "callrail_inbound";
    const result = await db.prepare(
      `INSERT INTO leads (source, lead_source_detail, utm_source, utm_medium, utm_campaign, name, phone, project_type,
       dumpster_size, rental_duration, notes, score,
       assigned_to, operator_name, operator_prospect_id, status, callrail_call_id, call_duration, call_recording_url,
       zone, city, operator_notified_at, outcome, assigned_at)
       VALUES ('callrail', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'new', ?, ?, ?, ?, ?, NULL, 'pending', NULL)`
    ).bind(
      sourceDetail,
      body.utm_source || null,
      body.utm_medium || null,
      body.utm_campaign || null,
      callerName,
      callerPhone,
      projectType,
      extracted.dumpster_size,
      extracted.rental_duration,
      extracted.notes,
      score,
      callId ? String(callId) : null,
      duration,
      body.recording || body.recording_url || null,
      zone,
      cityStore
    ).run();
    const leadId = result.meta.last_row_id;
    await logLeadEvent(db, leadId, "created", { source: "callrail", score, duration, caller: callerPhone, zone, city: cityStore, project_type: projectType }, "system");
    await logLeadEvent(db, leadId, "callrail_raw", body, "system");
    await notifyOwner(env, db, { name: callerName, phone: callerPhone, city: cityStore, zone, project_type: projectType, score, source: "callrail" }, leadId);
    await sendCustomerSMS(env, { name: callerName, phone: callerPhone, service: projectType, city: null, source: "callrail", consent: true }, leadId);
    return json({ success: true, lead_id: leadId, score, zone, project_type: projectType, assigned_to: null }, 201);
  } catch (e) {
    console.error("CallRail webhook error:", e);
    return err("Failed to process webhook", 500);
  }
}
__name(handleCallRailWebhook, "handleCallRailWebhook");
__name2(handleCallRailWebhook, "handleCallRailWebhook");
__name22(handleCallRailWebhook, "handleCallRailWebhook");
async function handleAdsCampaignCriteria(request, env) {
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN || !env.GOOGLE_ADS_REFRESH_TOKEN) {
    return err("Google Ads API credentials not configured", 502);
  }
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) {
    return err("Google Ads OAuth credentials not configured", 502);
  }
  try {
    const accessToken = await getGoogleAccessToken(env);
    const devToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const deviceQuery = `
      SELECT campaign_criterion.device.type,
             campaign_criterion.bid_modifier,
             campaign.name
      FROM campaign_criterion
      WHERE campaign_criterion.type = 'DEVICE'`;
    const scheduleQuery = `
      SELECT campaign_criterion.ad_schedule.day_of_week,
             campaign_criterion.ad_schedule.start_hour,
             campaign_criterion.ad_schedule.start_minute,
             campaign_criterion.ad_schedule.end_hour,
             campaign_criterion.ad_schedule.end_minute,
             campaign_criterion.bid_modifier,
             campaign.name
      FROM campaign_criterion
      WHERE campaign_criterion.type = 'AD_SCHEDULE'`;
    let deviceResults, scheduleResults;
    try {
      deviceResults = await queryGads(accessToken, devToken, deviceQuery);
    } catch (e) {
      deviceResults = [];
    }
    try {
      scheduleResults = await queryGads(accessToken, devToken, scheduleQuery);
    } catch (e) {
      scheduleResults = [];
    }
    const devices = deviceResults.map((row) => ({
      device: row.campaignCriterion?.device?.type || "unknown",
      bid_modifier: row.campaignCriterion?.bidModifier ?? null,
      campaign: row.campaign?.name || "unknown"
    }));
    const schedule = scheduleResults.map((row) => {
      const sched = row.campaignCriterion?.adSchedule || {};
      return {
        day: sched.dayOfWeek || "unknown",
        start_hour: sched.startHour ?? null,
        start_minute: sched.startMinute ?? null,
        end_hour: sched.endHour ?? null,
        end_minute: sched.endMinute ?? null,
        bid_modifier: row.campaignCriterion?.bidModifier ?? null,
        campaign: row.campaign?.name || "unknown"
      };
    });
    return json({ devices, schedule, fetched_at: (/* @__PURE__ */ new Date()).toISOString(), source: "google_ads_api" });
  } catch (e) {
    console.error("Campaign criteria error:", e);
    return err("Failed to fetch campaign criteria: " + e.message, 502);
  }
}
__name(handleAdsCampaignCriteria, "handleAdsCampaignCriteria");
__name2(handleAdsCampaignCriteria, "handleAdsCampaignCriteria");
__name22(handleAdsCampaignCriteria, "handleAdsCampaignCriteria");
export {
  worker_default as default
};
//# sourceMappingURL=index.js.map