// florence-auto-outreach-emails (Cloudflare Worker)
//
// Daily cron sender for operator/prospect outreach. Pulls due prospects from
// the florence-crm-api (`/due-actions`), sends sequenced emails via Resend (and
// SMS via Twilio as a fallback step type), then advances each prospect's step
// and records outreach_state back in the CRM.
//
// SOURCE OF TRUTH: this directory is the canonical, version-controlled copy,
// de-bundled from the live deployed Worker. Deploy from here going forward.
// Secrets/vars live in Cloudflare and are preserved across deploys.
//
// OFFER (updated 2026-06-20): retired the "2 free leads" pilot and all per-lead
// pricing. New offer = first operator to claim a zone gets their FIRST MONTH
// FREE (every lead in their area that month, exclusive), then a flat monthly
// rate to hold the zone — never a per-lead charge. Templates below reflect this.

const FROM_EMAIL = "charlie@florencescservices.com";
const FROM_NAME = "Charlie — Florence SC Services";
const PUBLIC_URL = "https://florence-auto-outreach-emails.cball8475.workers.dev";
const COMPANY_ADDRESS = "10685-B Hazelhurst Dr. #43191, Houston, TX 77043";
const COMPANY_PHONE = "(833) 968-3306";
const MAX_EMAILS_PER_RUN = 12;
const SEND_DELAY_MS = 1500;

function emailFooter(unsubscribeUrl) {
  let footer = `

—
Florence SC Services \xB7 ${COMPANY_ADDRESS} \xB7 ${COMPANY_PHONE}`;
  if (unsubscribeUrl) {
    footer += `
Prefer not to hear from us? Unsubscribe here: ${unsubscribeUrl}`;
  }
  return footer;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

async function unsubscribeUrlFor(env, prospectId) {
  const id = String(prospectId);
  const token = env.UNSUB_SECRET ? `&t=${await hmac(id, env.UNSUB_SECRET)}` : "";
  return `${PUBLIC_URL}/unsubscribe?id=${encodeURIComponent(id)}${token}`;
}

function isAuthed(request, url, env) {
  if (!env.ADMIN_SECRET) return false;
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const key = url.searchParams.get("key") || "";
  return bearer === env.ADMIN_SECRET || key === env.ADMIN_SECRET;
}

async function crmAPI(env, path, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      "Authorization": `Bearer ${env.CRM_API_TOKEN}`,
      "Content-Type": "application/json"
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${env.CRM_API_URL}${path}`, opts);
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`CRM API ${method} ${path}: ${res.status}: ${errBody}`);
  }
  return res.json();
}

const SEQUENCES = {
  new_prospect: {
    name: "New Prospect — 5 Touch",
    steps: [
      { day: 0, type: "email", label: "Intro email" },
      { day: 2, type: "email", label: "Follow-up email" },
      { day: 5, type: "email", label: "Value prop email" },
      { day: 8, type: "email", label: "Case study email" },
      { day: 12, type: "email", label: "Final email" }
    ]
  }
};

// Recipient-facing copy. New offer (first month free per zone, exclusive, then
// flat monthly, never per-lead). Written to read like a real local person, not
// AI: plain words, contractions, no em-dashes, lowercase casual subjects.
function generateEmailContent(env, prospect, stepIndex) {
  const company = prospect.short_name || prospect.name || "your company";
  const firstName = (prospect.contact_name || "there").trim().split(/\s+/)[0];
  const templates = [
    {
      subject: "dumpster leads in the pee dee",
      body: `Hi ${firstName},

I'll keep this short. If you Google "dumpster rental Florence SC," my site comes up on the first page, and it pulls in more requests than I can handle on my own. I only work with one operator per area, and nobody's locked in for yours yet.

These aren't recycled Angi leads. It's someone who actually needs a dumpster, sent to you and nobody else.

Here's the deal for the first operator who claims your area: your first month is free, and every lead that comes in for your zone that month goes to you alone. No contract, no card. After that it's a flat monthly rate to keep the zone, never a charge per lead.

Want me to set ${company} up for your area?

Charlie`
    },
    {
      subject: "re: dumpster leads in the pee dee",
      body: `Hi ${firstName},

Following up. I'm still getting dumpster requests in your area with no local operator to send them to.

First operator to claim the zone gets the first month free, every lead in the area that month, nobody else. Just say the word and I'll start sending them your way.

Charlie`
    },
    {
      subject: "how these are different from angi",
      body: `Hi ${firstName},

Quick reason this isn't the lead sites you've probably been burned by: when someone finds me looking for a dumpster, that lead goes to one company, you. Not blasted out to five outfits all calling the same person.

Your area's still open. Claim it and your first month's free, with every lead in your zone coming straight to you.

Charlie`
    },
    {
      subject: "what one lead did last month",
      body: `Hi ${firstName},

Real example: I sent an operator one lead and he closed a $400 dumpster rental off it within a couple hours. That kind of thing is sitting in my inbox right now with no one local to send it to.

Your area's still open. First month free if you claim it, then a flat monthly rate, never per lead. Want in?

Charlie`
    },
    {
      subject: "closing the loop",
      body: `Hi ${firstName},

I've reached out a couple times about sending dumpster leads to ${company}, so I'll leave it here and quit cluttering your inbox.

The spot for your area is open for now. First month's free if you ever want to claim it. Either way, hope you have a busy season.

Charlie`
    }
  ];
  return templates[stepIndex] || templates[0];
}

async function sendEmail(env, to, subject, body, unsubscribeUrl) {
  if (COMPANY_ADDRESS.includes("ADD YOUR MAILING ADDRESS")) {
    throw new Error("COMPANY_ADDRESS placeholder not replaced — refusing to send (CAN-SPAM needs a real postal address).");
  }
  const fromEmail = env.FROM_EMAIL || FROM_EMAIL;
  const fromName = env.FROM_NAME || FROM_NAME;
  const headers = {};
  if (unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${unsubscribeUrl}>, <mailto:${fromEmail}?subject=unsubscribe>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return sendEmailResend(env, {
    from: `${fromName} <${fromEmail}>`,
    to,
    subject,
    text: body + emailFooter(unsubscribeUrl),
    headers
  });
}

async function sendEmailResend(env, { to, subject, html, text, from, headers }) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
  const fromAddr = from || env.FROM_EMAIL || FROM_EMAIL;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromAddr,
      to: [to],
      subject,
      ...html ? { html } : {},
      ...text ? { text } : {},
      ...headers && Object.keys(headers).length ? { headers } : {}
    })
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend error ${res.status}: ${errBody}`);
  }
  return res.json();
}

async function sendSMS(env, to, message) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
    throw new Error("Twilio credentials not configured");
  }
  const cleanTo = "+1" + to.replace(/\D/g, "");
  const params = new URLSearchParams({
    To: cleanTo,
    From: env.TWILIO_PHONE_NUMBER,
    Body: message
  });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    }
  );
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Twilio error ${res.status}: ${errBody}`);
  }
  return true;
}

async function runOutreach(env) {
  const log = [];
  try {
    const { due } = await crmAPI(env, "/due-actions");
    if (!due || due.length === 0) {
      log.push("No due actions found");
      return log;
    }
    log.push(`Found ${due.length} prospects with due actions`);
    let emailsSent = 0;
    let smsSent = 0;
    for (const p of due) {
      const pid = p.id;
      if (emailsSent >= MAX_EMAILS_PER_RUN) {
        log.push(`⏸️ Per-run cap (${MAX_EMAILS_PER_RUN}) reached — remaining due prospects will send next run`);
        break;
      }
      if (!p.sequence) continue;
      const seq = SEQUENCES[p.sequence];
      if (!seq) {
        log.push(`Unknown sequence "${p.sequence}" for ${p.name}`);
        continue;
      }
      const stepIndex = p.sequence_step || 0;
      if (stepIndex >= seq.steps.length) continue;
      const step = seq.steps[stepIndex];
      const enrolledDate = new Date(p.sequence_started || p.created_at || Date.now());
      const now = new Date();
      const startDay = new Date(enrolledDate.getFullYear(), enrolledDate.getMonth(), enrolledDate.getDate());
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const daysSinceEnroll = Math.round((today - startDay) / (1e3 * 60 * 60 * 24));
      if (daysSinceEnroll < step.day) {
        log.push(`${p.short_name || p.name}: waiting — day ${daysSinceEnroll}/${step.day} for step ${stepIndex}`);
        continue;
      }
      if (step.type === "email" && p.email) {
        try {
          const { subject, body } = generateEmailContent(env, p, stepIndex);
          await sendEmail(env, p.email, subject, body, await unsubscribeUrlFor(env, pid));
          await crmAPI(env, "/outreach-state", "POST", {
            prospect_id: pid,
            step: stepIndex,
            status: "sent",
            type: "email",
            recipient: p.email
          });
          await crmAPI(env, `/prospects/${encodeURIComponent(pid)}/advance`, "POST", {
            note: `✅ Auto-sent: ${step.label} to ${p.email}`
          });
          await crmAPI(env, `/prospects/${encodeURIComponent(pid)}/activities`, "POST", {
            type: "email",
            note: `Auto-sent: ${step.label}`,
            draft_subject: subject,
            draft_body: body
          });
          emailsSent++;
          log.push(`✅ EMAIL sent to ${p.short_name || p.name} (${p.email}) — step ${stepIndex}`);
          await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
        } catch (e) {
          log.push(`❌ EMAIL failed for ${p.short_name || p.name}: ${e.message}`);
          try {
            await crmAPI(env, "/outreach-state", "POST", {
              prospect_id: pid,
              step: stepIndex,
              status: "failed",
              type: "email",
              reason: e.message
            });
          } catch {
          }
        }
      } else if (step.type === "sms" && p.phone) {
        try {
          const contactName = p.contact_name || "";
          const smsBody = `Hi${contactName ? " " + contactName : ""}, this is Charlie with Florence SC Services. We send exclusive dumpster rental leads to local operators in the Pee Dee. First operator to claim your area gets the first month free, every lead in your zone, nobody else. Reply YES or call (833) 968-3306. Reply STOP to opt out.`;
          await sendSMS(env, p.phone, smsBody);
          await crmAPI(env, "/outreach-state", "POST", {
            prospect_id: pid,
            step: stepIndex,
            status: "sent",
            type: "sms",
            recipient: p.phone
          });
          await crmAPI(env, `/prospects/${encodeURIComponent(pid)}/advance`, "POST", {
            note: `✅ Auto-sent: ${step.label} SMS to ${p.phone}`
          });
          smsSent++;
          log.push(`✅ SMS sent to ${p.short_name || p.name} (${p.phone}) — step ${stepIndex}`);
        } catch (e) {
          log.push(`❌ SMS failed for ${p.short_name || p.name}: ${e.message}`);
        }
      } else {
        const reason = step.type === "email" ? "no email address" : "no phone number";
        log.push(`⏭️ ${p.short_name || p.name}: ${reason} — skipping step ${stepIndex}`);
        await crmAPI(env, "/outreach-state", "POST", {
          prospect_id: pid,
          step: stepIndex,
          status: "skipped",
          type: step.type,
          reason
        });
      }
    }
    log.push(`--- Summary: ${emailsSent} emails sent, ${smsSent} SMS sent ---`);
    return log;
  } catch (e) {
    log.push(`FATAL ERROR: ${e.message}`);
    return log;
  }
}

export default {
  // Cron trigger — runs daily at 8am ET (12:00 UTC)
  async scheduled(event, env, ctx) {
    const log = await runOutreach(env);
    console.log("Scheduled outreach:", log.join("\n"));
  },
  // HTTP handler for manual trigger + status
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }
    const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    if (url.pathname === "/trigger" && request.method === "POST") {
      if (!isAuthed(request, url, env)) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors });
      }
      const log = await runOutreach(env);
      return new Response(JSON.stringify({ success: true, log }, null, 2), { headers: cors });
    }
    if (url.pathname === "/test-email" && request.method === "POST") {
      if (!isAuthed(request, url, env)) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors });
      }
      try {
        const result = await sendEmail(
          env,
          "charlie@florencescservices.com",
          "Resend production test — Florence SC Services",
          "This was sent from your live outreach sender (charlie@florencescservices.com) through Resend.\n\nThe footer below is exactly what every outreach email now carries (address + one-click unsubscribe).\n\n— Charlie",
          await unsubscribeUrlFor(env, "TEST")
        );
        return new Response(JSON.stringify({ success: true, result }, null, 2), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: cors });
      }
    }
    if (url.pathname === "/preview" && request.method === "GET") {
      if (!isAuthed(request, url, env)) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors });
      }
      const company = url.searchParams.get("company") || "Ace Roll-Off Dumpsters";
      const contact = url.searchParams.get("contact") || "Dave";
      const sample = { name: company, short_name: company, contact_name: contact };
      const steps = SEQUENCES.new_prospect.steps;
      const previews = [];
      for (let i = 0; i < steps.length; i++) {
        const { subject, body } = generateEmailContent(env, sample, i);
        previews.push({
          step: i,
          day: steps[i].day,
          label: steps[i].label,
          subject,
          body: body + emailFooter(await unsubscribeUrlFor(env, "PREVIEW"))
        });
      }
      return new Response(JSON.stringify({ sample, previews }, null, 2), { headers: cors });
    }
    if (url.pathname === "/status") {
      if (!isAuthed(request, url, env)) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors });
      }
      try {
        const { outreach } = await crmAPI(env, "/outreach-state");
        const sent = outreach.filter((o) => o.status === "sent");
        const skipped = outreach.filter((o) => o.status === "skipped");
        return new Response(
          JSON.stringify({
            total_records: outreach.length,
            total_sent: sent.length,
            total_skipped: skipped.length,
            recent_sent: sent.sort((a, b) => (b.sent_at || "").localeCompare(a.sent_at || "")).slice(0, 10)
          }, null, 2),
          { headers: cors }
        );
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { headers: cors });
      }
    }
    if (url.pathname === "/stop" && request.method === "POST") {
      if (!isAuthed(request, url, env)) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors });
      }
      try {
        const { prospect_id } = await request.json();
        await crmAPI(env, `/prospects/${encodeURIComponent(prospect_id)}/unenroll`, "POST");
        return new Response(JSON.stringify({ success: true, stopped: prospect_id }), { headers: cors });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { headers: cors });
      }
    }
    if (url.pathname === "/unsubscribe") {
      const id = url.searchParams.get("id");
      const t = url.searchParams.get("t") || "";
      if (id && id !== "PREVIEW" && id !== "TEST") {
        const expected = env.UNSUB_SECRET ? await hmac(String(id), env.UNSUB_SECRET) : t;
        if (t === expected) {
          try {
            await crmAPI(env, `/prospects/${encodeURIComponent(id)}/unenroll`, "POST");
          } catch (e) {
            console.log(`Unsubscribe error for ${id}: ${e.message}`);
          }
        } else {
          console.log(`Unsubscribe token mismatch for ${id}`);
        }
      }
      if (request.method === "POST") {
        return new Response("Unsubscribed", { status: 200 });
      }
      return new Response(
        `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;text-align:center"><h1>You're unsubscribed</h1><p>You won't receive any more emails from Florence SC Services.</p></body>`,
        { headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" } }
      );
    }
    return new Response(
      JSON.stringify({
        service: "Florence SC Services — Auto Outreach (D1-backed)",
        endpoints: {
          "POST /trigger": "Run outreach now (manual trigger) — auth required",
          "POST /test-email": "Send a production-path test email to charlie@florencescservices.com — auth required",
          "GET /preview": "Generate all 5 emails for a sample prospect WITHOUT sending (?company=&contact=) — auth required",
          "GET /status": "View current state and recent activity — auth required",
          "GET|POST /unsubscribe": "One-click opt-out for a prospect (public, signed link)",
          "POST /stop": "Stop outreach for a prospect { prospect_id } — auth required"
        }
      }, null, 2),
      { headers: cors }
    );
  }
};
