// florence-dashboard-proxy — v2.0.0
// Fronts dashboard.florencescservices.com (behind Cloudflare Access).
// Static assets come from the florence-dashboard Pages project; API-ish
// prefixes are proxied with the CRM bearer injected server-side so the
// browser app ships zero credentials:
//   /api/*      → CRM hub (florence-crm-api)
//   /engine/*   → outreach engine (florence-auto-outreach-emails)  [v2]
//   /outreach/* → secured Claude proxy (florence-outreach)          [v2]

const PAGES_UPSTREAM = 'florence-dashboard.pages.dev';
const API_UPSTREAM = 'api.florencescservices.com';
const ENGINE_UPSTREAM = 'florence-auto-outreach-emails.cball8475.workers.dev';
const OUTREACH_UPSTREAM = 'florence-outreach.cball8475.workers.dev';

function stripCfHeaders(h) {
  h.delete('cf-connecting-ip');
  h.delete('cf-ipcountry');
  h.delete('cf-ray');
  h.delete('cf-visitor');
}

function proxyTo(request, url, upstreamHost, prefix, env) {
  const upstreamPath = url.pathname === prefix ? '/' : url.pathname.slice(prefix.length);
  const upstreamUrl = `https://${upstreamHost}${upstreamPath}${url.search}`;
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${env.CRM_API_TOKEN}`);
  headers.set('Host', upstreamHost);
  stripCfHeaders(headers);
  return fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return proxyTo(request, url, API_UPSTREAM, '/api', env);
    }
    if (url.pathname === '/engine' || url.pathname.startsWith('/engine/')) {
      return proxyTo(request, url, ENGINE_UPSTREAM, '/engine', env);
    }
    if (url.pathname === '/outreach' || url.pathname.startsWith('/outreach/')) {
      return proxyTo(request, url, OUTREACH_UPSTREAM, '/outreach', env);
    }

    url.hostname = PAGES_UPSTREAM;
    url.protocol = 'https:';
    url.port = '';
    const headers = new Headers(request.headers);
    headers.set('Host', PAGES_UPSTREAM);
    stripCfHeaders(headers);

    return fetch(url.toString(), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    });
  },
};
