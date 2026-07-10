# florence-lead-followup (v3)

Mon–Fri 14:00 UTC: nudges operators about assigned-but-unresponded leads —
follow-up 1 at ≥24 h, follow-up 2 at ≥72 h, `overdue_flagged` + owner alert at
≥120 h. All email goes through the outreach engine's `Mailer` service binding
(Resend). Results land in `lead_events`.

**v3 fixes the v2 bug** where `follow_up_N_sent` was stamped even when the
(never-configured) Brevo send silently failed: a follow-up is now marked sent
**only after the send that matters is confirmed** — the operator's copy when
they have an email on file, otherwise Charlie's copy. Failed sends log and
retry on the next run; the overdue flag is likewise only written after the
alert email succeeds.

## Endpoints

- `GET /health` — `{ok, version, mailer_bound}`
- `GET /?token=<MANUAL_TRIGGER_TOKEN>` or `Authorization: Bearer <CRM token>`
  (validated against the CRM API) — run the sweep now, returns the summary.

## Test

```sh
curl https://florence-lead-followup.cball8475.workers.dev/health
curl -H "Authorization: Bearer $TOKEN" https://florence-lead-followup.cball8475.workers.dev/
# then: GET /leads/:id/events on the CRM → followup_N_attempt entries
```

Bindings: D1 `DB` → florence-crm; service `MAILER` →
florence-auto-outreach-emails#Mailer (deploy the engine first). Secret:
`MANUAL_TRIGGER_TOKEN` (legacy, optional). `BREVO_API_KEY` is dead — delete
whenever. Deploys via `.github/workflows/deploy-lead-followup.yml`.
