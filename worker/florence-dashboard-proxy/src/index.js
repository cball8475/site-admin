// florence-dashboard-proxy
// Serves dashboard.florencescservices.com (behind Cloudflare Access):
//   /api/*     -> florence-crm-api via service binding, bearer attached
//   everything -> florence-dashboard.pages.dev (the built site-admin frontend)
//
// Seeded from the live deployed Worker, then hardened: /api now uses the
// CRM_API service binding (same-zone public fetch to a route-served worker
// fails with error 1042), with a public-fetch fallback if the binding is
// ever missing.
const PAGES_UPSTREAM = 'florence-dashboard.pages.dev';
const API_UPSTREAM   = 'api.florencescservices.com';

function stripCfHeaders(h) {
  h.delete('cf-connecting-ip');
  h.delete('cf-ipcountry');
  h.delete('cf-ray');
  h.delete('cf-visitor');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const apiPath = url.pathname === '/api' ? '/' : url.pathname.slice(4);
      const apiUrl = `https://${API_UPSTREAM}${apiPath}${url.search}`;
      const headers = new Headers(request.headers);
      headers.set('Authorization', `Bearer ${env.CRM_API_TOKEN}`);
      headers.set('Host', API_UPSTREAM);
      stripCfHeaders(headers);
      const init = {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual',
      };
      return env.CRM_API
        ? env.CRM_API.fetch(new Request(apiUrl, init))
        : fetch(apiUrl, init);
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
