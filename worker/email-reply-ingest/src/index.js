// email-reply-ingest — Cloudflare Email Worker for florencescservices.com
//
// Closes the outreach-tracking gap where a prospect's email reply landed only
// in an inbox while the sequence kept auto-sending (SOMO Trash got a step-3
// email 3.5h AFTER accepting the trial on 2026-07-15).
//
// On every inbound email:
//   1. Look up the sender in the prospects table (florence-crm D1, direct binding).
//   2. If it's a known prospect: log a 'reply' activity with the message
//      excerpt, HALT their sequence (sequence = NULL), suppress the address
//      (reason 'replied_auto') so the engine can never mail them again, and
//      write a 'reply_received' row to outreach_log.
//   3. Always forward the original message to the owner inbox so normal email
//      flow is unchanged.
//
// No secrets required — D1 binding only. FORWARD_TO can be overridden with a
// plain var; the destination must be a verified Email Routing address.

const DEFAULT_FORWARD_TO = "cball8475@gmail.com";
const EXCERPT_LIMIT = 1500;

function extractTextBody(raw) {
  // Minimal MIME text extraction: prefer the first text/plain part; fall back
  // to stripping tags from text/html; last resort, the tail of the raw body.
  const boundaryMatch = raw.match(/boundary="?([^";\r\n]+)"?/i);
  if (boundaryMatch) {
    const parts = raw.split("--" + boundaryMatch[1]);
    for (const part of parts) {
      if (/content-type:\s*text\/plain/i.test(part)) {
        const body = part.split(/\r?\n\r?\n/).slice(1).join("\n\n");
        return decodeQuotedPrintable(body).trim();
      }
    }
    for (const part of parts) {
      if (/content-type:\s*text\/html/i.test(part)) {
        const body = part.split(/\r?\n\r?\n/).slice(1).join("\n\n");
        return decodeQuotedPrintable(body).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
  }
  const idx = raw.search(/\r?\n\r?\n/);
  return idx === -1 ? "" : raw.slice(idx).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeQuotedPrintable(s) {
  return s
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, h) => {
      try { return String.fromCharCode(parseInt(h, 16)); } catch { return _; }
    });
}

export default {
  async email(message, env, ctx) {
    const forwardTo = env.FORWARD_TO || DEFAULT_FORWARD_TO;
    const from = (message.from || "").toLowerCase().trim();
    const subject = message.headers.get("subject") || "(no subject)";
    const msgId = message.headers.get("message-id") || null;

    try {
      // Known prospect? (match on stored email, case-insensitive)
      const prospect = await env.DB.prepare(
        "SELECT id, name, short_name, sequence, sequence_step FROM prospects WHERE LOWER(email) = ?"
      ).bind(from).first();

      if (prospect) {
        // Dedup on message-id so retries don't double-log. Exact match via
        // json_extract — a LIKE '%id%' probe treats % and _ in an inbound
        // Message-ID as wildcards, which can match an unrelated row and
        // silently skip the halt.
        if (msgId) {
          const dup = await env.DB.prepare(
            "SELECT id FROM outreach_log WHERE event = 'reply_received' AND json_extract(detail, '$.message_id') = ? LIMIT 1"
          ).bind(msgId).first();
          if (dup) { await message.forward(forwardTo); return; }
        }

        // Read up to 64KB of the raw message for a body excerpt
        let excerpt = "";
        try {
          const rawBuf = await new Response(message.raw).arrayBuffer();
          const raw = new TextDecoder("utf-8", { fatal: false }).decode(rawBuf.slice(0, 65536));
          excerpt = extractTextBody(raw).slice(0, EXCERPT_LIMIT);
        } catch (e) {
          excerpt = "(body unavailable: " + (e.message || "parse error") + ")";
        }

        const halted = !!prospect.sequence;
        // All four writes in one batch: D1 runs a batch as a transaction, so
        // the halt, suppression, and audit rows land together or not at all.
        // The old sequential awaits could log the reply, then die before
        // halting the sequence — a logged reply with a still-running sequence
        // is the exact SOMO Trash incident this worker exists to prevent.
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO activities (prospect_id, type, note) VALUES (?, 'reply', ?)"
          ).bind(prospect.id,
            `Inbound reply — "${subject}"` + (halted ? " [sequence auto-halted]" : "") + `\n\n${excerpt}`
          ),
          env.DB.prepare(
            "UPDATE prospects SET sequence = NULL, sequence_started = NULL, last_contact = datetime('now'), updated_at = datetime('now') WHERE id = ?"
          ).bind(prospect.id),
          env.DB.prepare(
            "INSERT INTO suppression (email, reason, prospect_id) VALUES (?, 'replied_auto', ?) " +
            "ON CONFLICT(email) DO UPDATE SET reason = CASE WHEN suppression.reason LIKE 'replied%' THEN suppression.reason ELSE 'replied_auto' END"
          ).bind(from, prospect.id),
          env.DB.prepare(
            "INSERT INTO outreach_log (source, event, prospect_id, name, email, detail) VALUES ('email-reply-ingest', 'reply_received', ?, ?, ?, ?)"
          ).bind(prospect.id, prospect.short_name || prospect.name, from, JSON.stringify({
            subject, message_id: msgId, sequence_halted: halted,
            was_step: prospect.sequence_step ?? null, excerpt_chars: excerpt.length
          })),
        ]);
      } else {
        // Unknown sender — log lightly so reply coverage is auditable
        await env.DB.prepare(
          "INSERT INTO outreach_log (source, event, email, detail) VALUES ('email-reply-ingest', 'inbound_nonprospect', ?, ?)"
        ).bind(from, JSON.stringify({ subject, to: message.to || null })).run();
      }
    } catch (e) {
      // Never let ingestion failures block mail delivery — but never let them
      // vanish either. The failure mode here looks IDENTICAL to success from
      // the inbox (the mail still forwards) while the sequence keeps sending.
      // So: write a durable ingest_error marker (best effort — D1 itself may
      // be the thing that's down) and log loudly for Workers observability.
      console.error(`email-reply-ingest FAILED for ${from} ("${subject}"):`, e.message || e,
        "— prospect writes were NOT committed; if this sender is a prospect their sequence was NOT halted");
      try {
        await env.DB.prepare(
          "INSERT INTO outreach_log (source, event, email, detail) VALUES ('email-reply-ingest', 'ingest_error', ?, ?)"
        ).bind(from, JSON.stringify({
          subject, message_id: msgId, error: String(e.message || e),
          note: "sequence halt/suppression NOT applied — investigate and halt manually if prospect",
        })).run();
      } catch (logErr) {
        console.error("email-reply-ingest DOUBLE FAULT — could not write ingest_error to D1:", logErr.message || logErr);
      }
    }

    await message.forward(forwardTo);
  }
};
