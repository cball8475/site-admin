# florence-auto-outreach-emails (Cloudflare Worker)

Daily cron sender for operator/prospect outreach. Pulls due prospects from
`florence-crm-api` (`GET /due-actions`), sends sequenced emails via **Resend**
(and SMS via Twilio for `sms` step types), then advances each prospect's step
and records `outreach_state` back in the CRM.

Public URL: `https://florence-auto-outreach-emails.cball8475.workers.dev`

## Source of truth

This directory is the **canonical, version-controlled source**, de-bundled from
the live deployed Worker. Deploy from here going forward.

## How it sends

- **Cron:** `0 12 * * *` (08:00 ET) — `scheduled()` → `runOutreach()`.
- **Recipients:** only prospects the CRM returns from `/due-actions`, i.e.
  `sequence IS NOT NULL` and whose next step's `day` offset has elapsed since
  `sequence_started`. **Unenrolled prospects are never emailed.** So nothing
  goes out until prospects are enrolled in a sequence from the dashboard.
- **Cap:** `MAX_EMAILS_PER_RUN = 12` per run, 1.5s apart.
- **CAN-SPAM:** every email carries the postal address footer + a signed
  one-click unsubscribe (`List-Unsubscribe` + `List-Unsubscribe-Post`).

## Offer / copy (updated 2026-06-20)

Templates use the current offer: **first operator to claim a zone gets their
first month free** (every lead in their area that month, exclusive), then a
**flat monthly rate** to hold the zone — **never a per-lead charge**. The old
"2 free leads" pilot and all per-lead pricing are retired and must not reappear
here. Note this worker only carries the `new_prospect` (dumpster, 5-touch)
sequence.

## Deploy

Secrets and the cron already exist on the live Worker; secrets are preserved
across deploys. From this directory:

```sh
export CLOUDFLARE_API_TOKEN=...   # Workers Scripts edit
npx wrangler deploy
```

## Verify before/after deploy (no sends)

```sh
# Render all 5 emails for a sample prospect WITHOUT sending:
curl -s "https://florence-auto-outreach-emails.cball8475.workers.dev/preview?company=Ace%20Dumpsters&contact=Dave&key=$ADMIN_SECRET"

# Production-path test email to charlie@ (real send, to yourself):
curl -s -X POST "https://florence-auto-outreach-emails.cball8475.workers.dev/test-email?key=$ADMIN_SECRET"
```
