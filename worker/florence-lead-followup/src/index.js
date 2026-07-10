// florence-lead-followup — v3.0.0
// v3 (2026-07): Brevo removed. All email now goes through the outreach
// engine's Mailer service binding (Resend, single key holder), and a
// follow-up is marked sent ONLY after the send is confirmed — the v2 bug
// marked follow_up_N_sent even when Brevo (unconfigured) dropped everything,
// which silently killed the whole nudge loop.
//
// Cron: Mon–Fri 14:00 UTC (10:00 AM ET). For each assigned, unresponded lead:
//   ≥24h  — follow-up 1 email to the operator (Charlie CC'd via own copy)
//   ≥72h  — follow-up 2 (final nudge)
//   ≥120h — overdue_flagged lead_event + alert email to Charlie
//
// Send policy: when the operator has an email on file, THAT send decides
// success; Charlie's copy is best-effort. Without an operator email, Charlie's
// copy is the send that counts. Every result lands in lead_events.

const CHARLIE = "charlie@florencescservices.com";
const FROM = "Florence SC Services <charlie@florencescservices.com>";
const VERSION = "3.0.0";

// ── Send helper (via the engine's Mailer; returns {ok, id, error}) ──────────
async function sendEmail(env, to, subject, html, kind) {
  if (!env.MAILER) {
    console.error("MAILER binding missing — florence-lead-followup cannot send");
    return { ok: false, error: "mailer_binding_missing" };
  }
  try {
    const r = await env.MAILER.send({ to, subject, html, from: FROM, kind: kind || "followup" });
    if (!r || !r.ok) console.error(`Mailer send to ${to} failed: ${JSON.stringify(r).slice(0, 200)}`);
    return r || { ok: false, error: "no_response" };
  } catch (e) {
    console.error(`Mailer send to ${to} threw:`, e);
    return { ok: false, error: e.message || String(e) };
  }
}

// ── Shared email shells (unchanged layout from v2) ───────────────────────────
function buildFollowUpHtml(lead, leadId, followUpNum, hoursElapsed) {
  const confirmUrl = `https://api.florencescservices.com/leads/${leadId}/operator-responded?confirm=1`;
  const dashUrl = `https://dashboard.florencescservices.com`;
  const zoneLabel = lead.zone ? `Zone ${lead.zone}` : "Unzoned";
  const urgencyColor = followUpNum === 1 ? "#d97706" : "#dc2626";
  const urgencyLabel = followUpNum === 1
    ? `⏱ 24-hour follow-up — Lead #${leadId} is waiting`
    : `🚨 Final notice — Lead #${leadId} has been unworked for ${Math.round(hoursElapsed)} hours`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <tr>
          <td style="background:${urgencyColor};padding:16px 24px;color:#fff;font-size:15px;font-weight:700;">
            ${urgencyLabel}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
              <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">Lead #</td><td style="padding:6px 12px;font-size:13px;color:#111827;border-bottom:1px solid #e5e7eb;">${leadId}</td></tr>
              <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">Name</td><td style="padding:6px 12px;font-size:13px;color:#111827;border-bottom:1px solid #e5e7eb;">${lead.name || "—"}</td></tr>
              <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">Phone</td><td style="padding:6px 12px;font-size:13px;color:#111827;border-bottom:1px solid #e5e7eb;">${lead.phone || "—"}</td></tr>
              <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">City / Zone</td><td style="padding:6px 12px;font-size:13px;color:#111827;border-bottom:1px solid #e5e7eb;">${lead.city || "—"} · ${zoneLabel}</td></tr>
              <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">Size</td><td style="padding:6px 12px;font-size:13px;color:#111827;border-bottom:1px solid #e5e7eb;">${lead.dumpster_size || "—"}</td></tr>
              <tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;font-size:13px;color:#374151;">Est. Revenue</td><td style="padding:6px 12px;font-size:13px;color:#111827;">${lead.estimated_revenue || "TBD"}</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 20px;text-align:center;">
            <a href="${confirmUrl}" style="display:inline-block;background:#16a34a;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:6px;text-decoration:none;">
              ✓ Confirm Received — Lead #${leadId}
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 24px 20px;border-top:1px solid #f3f4f6;">
            <a href="${dashUrl}" style="font-size:12px;color:#6b7280;">Open Dashboard</a>
            <span style="color:#d1d5db;margin:0 8px;">·</span>
            <span style="font-size:12px;color:#6b7280;">Florence SC Services · (843) 938-0480</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildOverdueAlertHtml(lead, leadId, hoursElapsed) {
  const dashUrl = `https://dashboard.florencescservices.com`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <tr>
          <td style="background:#7f1d1d;padding:16px 24px;color:#fff;font-size:15px;font-weight:700;">
            ⛔ Lead #${leadId} is overdue — ${Math.round(hoursElapsed)} hours with no response
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px;font-size:14px;color:#374151;line-height:1.6;">
            <p style="margin:0 0 12px">Lead #${leadId} (${lead.name || "Unknown"} · ${lead.phone || "no phone"}) has been unworked for ${Math.round(hoursElapsed)} hours. Two follow-up attempts have already been sent.</p>
            <p style="margin:0 0 12px">Operator: ${lead.operator_name || "Unassigned"}</p>
            <p style="margin:0">Action needed: call the operator directly or reassign this lead.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 20px;">
            <a href="${dashUrl}" style="display:inline-block;background:#1e3a5f;color:#fff;font-size:13px;font-weight:600;padding:10px 20px;border-radius:6px;text-decoration:none;">
              Open Dashboard
            </a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function logLeadEvent(db, leadId, eventType, eventData) {
  try {
    await db.prepare("INSERT INTO lead_events (lead_id, event_type, event_data, actor) VALUES (?, ?, ?, 'system')")
      .bind(leadId, eventType, JSON.stringify(eventData)).run();
  } catch (e) {
    console.error("lead_events insert failed:", e);
  }
}

async function runFollowups(env) {
  const db = env.DB;
  const now = new Date();
  const { results: leads } = await db.prepare(`
    SELECT l.*, p.email as operator_email
    FROM leads l
    LEFT JOIN prospects p ON l.assigned_to = p.id
    WHERE l.operator_notified_at IS NOT NULL
      AND (l.operator_responded_at IS NULL OR l.operator_responded IS NULL OR l.operator_responded = 0)
      AND l.outcome = 'pending'
      AND l.status NOT IN ('spam', 'closed', 'booked')
    ORDER BY l.operator_notified_at ASC
  `).all();

  console.log(`florence-lead-followup v${VERSION}: ${leads.length} unresponded assigned leads to evaluate`);
  let fu1Sent = 0, fu2Sent = 0, overdueFlagged = 0, failures = 0;

  for (const lead of leads) {
    const notifiedAt = new Date(lead.operator_notified_at);
    const hoursElapsed = (now - notifiedAt) / (1000 * 60 * 60);

    // ≥120h: flag overdue + alert Charlie (event only written once, and only
    // after the alert actually goes out so a failed alert retries next run).
    if (hoursElapsed >= 120 && lead.follow_up_2_sent) {
      const existing = await db.prepare(
        "SELECT id FROM lead_events WHERE lead_id = ? AND event_type = 'overdue_flagged'"
      ).bind(lead.id).first();
      if (!existing) {
        const html = buildOverdueAlertHtml(lead, lead.id, hoursElapsed);
        const r = await sendEmail(env, CHARLIE,
          `⛔ OVERDUE: Lead #${lead.id} — ${lead.name || "Unknown"} · ${Math.round(hoursElapsed)}hrs unworked`,
          html, "owner_alert");
        if (r.ok) {
          await db.prepare(
            "INSERT INTO lead_events (lead_id, event_type, event_data, actor) VALUES (?, 'overdue_flagged', ?, 'system')"
          ).bind(lead.id, JSON.stringify({ hours_elapsed: Math.round(hoursElapsed), flagged_at: now.toISOString(), alert_id: r.id || null })).run();
          overdueFlagged++;
          console.log(`Overdue flagged: lead #${lead.id} (${Math.round(hoursElapsed)}hrs)`);
        } else {
          failures++;
          console.error(`Overdue alert send failed for lead #${lead.id}: ${r.error}`);
        }
      }
      continue;
    }

    // ≥72h: follow-up 2 (final nudge)
    if (hoursElapsed >= 72 && lead.follow_up_1_sent && !lead.follow_up_2_sent) {
      const html = buildFollowUpHtml(lead, lead.id, 2, hoursElapsed);
      const charlieRes = await sendEmail(env, CHARLIE,
        `[Follow-up 2] Lead #${lead.id} — ${lead.name || "Unknown"} · ${Math.round(hoursElapsed)}hrs unworked`, html, "owner_alert");
      let operatorRes = null;
      if (lead.operator_email) {
        operatorRes = await sendEmail(env, lead.operator_email,
          `[FINAL NOTICE] New lead #${lead.id} still awaiting your response`, html, "followup");
      }
      const delivered = lead.operator_email ? (operatorRes && operatorRes.ok) : charlieRes.ok;
      await logLeadEvent(db, lead.id, "followup_2_attempt", {
        operator: lead.operator_email ? { to: lead.operator_email, ok: !!(operatorRes && operatorRes.ok), id: operatorRes?.id || null, error: operatorRes?.error || null } : null,
        charlie: { ok: charlieRes.ok, id: charlieRes.id || null, error: charlieRes.error || null },
        marked_sent: !!delivered
      });
      if (delivered) {
        // Only stamp it sent once the send that matters was confirmed.
        await db.prepare("UPDATE leads SET follow_up_2_sent = datetime('now') WHERE id = ?").bind(lead.id).run();
        fu2Sent++;
        console.log(`Follow-up 2 sent: lead #${lead.id}`);
      } else {
        failures++;
        console.error(`Follow-up 2 NOT marked sent for lead #${lead.id} — send failed, will retry next run`);
      }
      continue;
    }

    // ≥24h: follow-up 1
    if (hoursElapsed >= 24 && !lead.follow_up_1_sent) {
      const html = buildFollowUpHtml(lead, lead.id, 1, hoursElapsed);
      const charlieRes = await sendEmail(env, CHARLIE,
        `[Follow-up 1] Lead #${lead.id} — ${lead.name || "Unknown"} · ${Math.round(hoursElapsed)}hrs unworked`, html, "owner_alert");
      let operatorRes = null;
      if (lead.operator_email) {
        operatorRes = await sendEmail(env, lead.operator_email,
          `Reminder: New lead #${lead.id} is waiting for your response`, html, "followup");
      }
      const delivered = lead.operator_email ? (operatorRes && operatorRes.ok) : charlieRes.ok;
      await logLeadEvent(db, lead.id, "followup_1_attempt", {
        operator: lead.operator_email ? { to: lead.operator_email, ok: !!(operatorRes && operatorRes.ok), id: operatorRes?.id || null, error: operatorRes?.error || null } : null,
        charlie: { ok: charlieRes.ok, id: charlieRes.id || null, error: charlieRes.error || null },
        marked_sent: !!delivered
      });
      if (delivered) {
        await db.prepare("UPDATE leads SET follow_up_1_sent = datetime('now') WHERE id = ?").bind(lead.id).run();
        fu1Sent++;
        console.log(`Follow-up 1 sent: lead #${lead.id}`);
      } else {
        failures++;
        console.error(`Follow-up 1 NOT marked sent for lead #${lead.id} — send failed, will retry next run`);
      }
    }
  }

  const summary = { evaluated: leads.length, fu1_sent: fu1Sent, fu2_sent: fu2Sent, overdue_flagged: overdueFlagged, send_failures: failures, version: VERSION };
  console.log(`florence-lead-followup complete —`, JSON.stringify(summary));
  return summary;
}

// Manual-trigger auth: legacy ?token=MANUAL_TRIGGER_TOKEN, or a Bearer token
// validated against the CRM API's /auth/check (so the CRM token works here
// too without this worker storing a copy).
const validBearerCache = new Map();
async function bearerIsValid(bearer) {
  if (!bearer) return false;
  const hit = validBearerCache.get(bearer);
  if (hit && hit > Date.now()) return true;
  try {
    const res = await fetch("https://api.florencescservices.com/auth/check", { headers: { Authorization: `Bearer ${bearer}` } });
    if (res.ok) {
      validBearerCache.set(bearer, Date.now() + 5 * 60 * 1000);
      return true;
    }
  } catch {}
  return false;
}

export default {
  async scheduled(event, env, ctx) {
    await runFollowups(env);
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, version: VERSION, mailer_bound: !!env.MAILER }), { headers: { "Content-Type": "application/json" } });
    }
    const token = url.searchParams.get("token");
    const auth = request.headers.get("Authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const legacyOk = env.MANUAL_TRIGGER_TOKEN && token === env.MANUAL_TRIGGER_TOKEN;
    if (!legacyOk && !(await bearerIsValid(bearer))) {
      return new Response("Unauthorized", { status: 401 });
    }
    const summary = await runFollowups(env);
    return new Response(JSON.stringify({ ok: true, triggered: new Date().toISOString(), ...summary }), {
      headers: { "Content-Type": "application/json" }
    });
  }
};
