# florence-crm-api (Cloudflare Worker)

Lead-capture + CRM API for Florence SC Services LLC. Handles website form
submissions, CallRail webhooks, Twilio inbound SMS commands, Google Ads / GSC
reporting, and a daily SEO snapshot cron.

Public URL: `https://florence-crm-api.cball8475.workers.dev`

## Source of truth

This directory is the **canonical, version-controlled source**. It was seeded
from the live deployed Worker (the only complete copy that existed) and is
intentionally close to the deployed bundle so production behavior is preserved.
Deploy from here going forward.

## Deploy

Secrets and the D1 binding already exist on the live Worker; secrets are
preserved across deploys. From this directory:

```sh
# auth (one of):
export CLOUDFLARE_API_TOKEN=...   # token with Workers Scripts + D1 edit
npx wrangler deploy
```

`wrangler.toml` declares the D1 binding and the daily `0 6 * * *` cron so they
are not dropped on deploy.

## Recent changes (customer SMS + CallRail fixes)

1. **`sendCustomerSMS()`** — texts the *customer* a transactional confirmation
   on `website_form` + `callrail` leads, from the approved A2P 10DLC number
   `+18437734140`. Only sent with consent on file; every message includes STOP.
   (`sendLeadSMS` still alerts the operator cell separately.)
2. **CallRail Voice Assist extraction** — `extractCallRailFields()` pulls the
   captured service and ZIP from the webhook payload (probes documented + likely
   fields, then text-scans as a fallback). `project_type` is now stored.
3. **Zone fix** — `detectZone()` now runs on the Voice-Assist-captured ZIP
   instead of the unreliable `caller_city`.

### Field-name discovery (do this while Voice Assist trial is active)

CallRail's exact Voice Assist payload field names couldn't be confirmed from
docs. The handler now logs the **raw payload** to `lead_events` as
`event_type = 'callrail_raw'`. After a real captured call, inspect it:

```sql
SELECT event_data FROM lead_events
WHERE event_type = 'callrail_raw' ORDER BY id DESC LIMIT 1;
```

Then tighten the field list in `extractCallRailFields()` to the confirmed names.

## Owner lead alerts (v2.23.0)

Every new lead (website form, CallRail webhook, manual/API create) triggers
`notifyOwner()`:

1. **SMS** via Twilio to the operator cell (unchanged), but the send result is
   now captured instead of thrown away.
2. **Email backup** via Resend to `cball8475@gmail.com` from
   `leads@florencescservices.com` — sends regardless of SMS outcome and flags
   in the body whether the SMS succeeded. Override recipients with the
   `LEAD_ALERT_TO` / `LEAD_ALERT_FROM` vars.
3. Both results are logged to `lead_events` as `event_type = 'owner_alert'`,
   so silent SMS failures are visible per-lead (`GET /leads/:id/events`).

Requires the `RESEND_API_KEY` secret (same key as the eaton-ehs-api digest):

```sh
npx wrangler secret put RESEND_API_KEY
```

Caveat: Twilio can accept a message (logged `sent: true`) that carriers later
drop for A2P reasons (e.g. error 30034). If SMS shows sent but never arrives,
check Twilio Console → Monitor → Messaging logs for the delivery error.

## FSC memory D1 layer (v2.24.0)

`GET/POST /memory` (Bearer `API_TOKEN`) — the D1 layer of the three-layer FSC
memory system (D1 + `kb/*.md` + GitHub). GET filters: `q`, `category`,
`limit`. POST `{category, title, content}`; titles are unique and re-POSTing
a title updates the entry. `/health/db` idempotently seeds the table and
reports `memory_rows`, so a session without the API token can still land an
entry by extending the seed and deploying.

## Open follow-ups

- Confirm `+18437734140` is attached to Messaging Service
  `MGd33be27a610877277842142626fc867c` (operator alerts already send from it,
  so it works — this is a tidiness check for A2P routing).
- Optionally route customer SMS through the Messaging Service SID instead of a
  bare `From` number once confirmed.
