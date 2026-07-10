# florence-dashboard-proxy (v2)

Fronts `dashboard.florencescservices.com` — which sits behind **Cloudflare
Access** (`florencesc.cloudflareaccess.com`). Static assets stream from the
`florence-dashboard` Pages project; three prefixes are reverse-proxied with
the CRM bearer injected server-side, so the browser app ships zero
credentials:

| Prefix | Upstream |
|---|---|
| `/api/*` | `api.florencescservices.com` (florence-crm-api) |
| `/engine/*` | `florence-auto-outreach-emails.cball8475.workers.dev` |
| `/outreach/*` | `florence-outreach.cball8475.workers.dev` |

`workers_dev = false` on purpose: a workers.dev route would hand out
token-injected responses to anyone, bypassing Access. Keep it off. The custom
domain/route is configured in the Cloudflare dashboard.

Secret: `CRM_API_TOKEN`. Deploys via
`.github/workflows/deploy-dashboard-proxy.yml`.

Test (expects the Access redirect when unauthenticated):

```sh
curl -sI https://dashboard.florencescservices.com/engine/preflight | head -3   # 302 → cloudflareaccess.com
```
