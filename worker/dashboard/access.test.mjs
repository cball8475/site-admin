import worker from './src/index.js';

const fakeBinding = { get: async () => 'fsc_fake_value_not_real' };
const env0 = { CRM_ORIGIN: 'https://example.invalid', CRM_API_TOKEN: fakeBinding,
               ASSETS: { fetch: async () => new Response('SPA SHELL', { status: 200 }) } };
const envCfg = { ...env0, ACCESS_TEAM_DOMAIN: 'https://fsc.cloudflareaccess.com',
                 ACCESS_POLICY_AUD: 'deadbeef' };

let pass = 0, fail = 0;
const check = (name, cond, got) => {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}  (got ${got})`); fail++; }
};

// 1. /__health is public and reports config sanity
let r = await worker.fetch(new Request('https://d.example/__health'), env0);
let b = await r.json();
check('/__health 200 while unconfigured', r.status === 200, r.status);
check('/__health reports access_configured:false', b.access_configured === false, b.access_configured);
check('/__health reports crm_binding_present:true', b.crm_binding_present === true, b.crm_binding_present);

// 2. Unconfigured Access => everything refused (fail CLOSED, not open)
for (const p of ['/', '/api/prospects', '/index.html']) {
  r = await worker.fetch(new Request('https://d.example' + p), env0);
  check(`unconfigured: ${p} refused`, r.status === 403, r.status);
}

// 3. Configured but NO token => refused
for (const p of ['/', '/api/prospects']) {
  r = await worker.fetch(new Request('https://d.example' + p), envCfg);
  check(`no JWT: ${p} refused`, r.status === 403, r.status);
}

// 4. Garbage / forged tokens => refused (signature must be verified)
for (const tok of ['not-a-jwt', 'a.b.c',
   'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJhdWQiOlsiZGVhZGJlZWYiXSwiaXNzIjoiaHR0cHM6Ly9mc2MuY2xvdWRmbGFyZWFjY2Vzcy5jb20ifQ.']) {
  r = await worker.fetch(new Request('https://d.example/api/prospects',
    { headers: { 'Cf-Access-Jwt-Assertion': tok } }), envCfg);
  check(`forged token (${tok.slice(0,18)}...) refused`, r.status === 403, r.status);
}

// 5. Body must not leak the reason
r = await worker.fetch(new Request('https://d.example/'), envCfg);
const text = await r.text();
check('denial body leaks no detail', !/jwt|signature|aud|issuer/i.test(text), JSON.stringify(text));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
