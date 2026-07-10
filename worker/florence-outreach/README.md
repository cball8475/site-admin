# florence-outreach (v2 — secured Claude proxy)

Powers the dashboard's AI copy buttons: `POST /` with an Anthropic Messages
payload (`{model?, max_tokens?, messages}`) returns the raw Anthropic
response.

**v2 closed the hole:** v1 had no auth at all — anyone could spend the
Anthropic key. Now every POST needs `Authorization: Bearer <token>`, validated
by delegation against the CRM API's `GET /auth/check` (cached ~5 min; this
worker stores no extra secret), and CORS only answers for the dashboard
origins. The dashboard calls it through florence-dashboard-proxy (`/outreach/*`,
token injected server-side behind Cloudflare Access). `max_tokens` is capped
at 4000 and the model must be a `claude-*` id.

The `/email-search` route the old dashboard called never existed here — the
email finder lives on the engine (`florence-auto-outreach-emails
POST /email-search`).

## Test

```sh
# no token → 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}' \
  https://florence-outreach.cball8475.workers.dev
# with the CRM token → 200 + Anthropic response
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"say hi"}]}' \
  https://florence-outreach.cball8475.workers.dev
```

Secret: `ANTHROPIC_API_KEY`. Deploys via
`.github/workflows/deploy-florence-outreach.yml` (which asserts the 401).
