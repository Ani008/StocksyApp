// Security review item 10 — API security headers.
// No database or Redis needed: a tiny express app with just the middleware.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { securityHeaders } = require('../middleware/securityHeaders');

async function withApp(env, fn) {
  const app = express();
  app.use(...securityHeaders({ env }));
  app.get('/data', (req, res) => res.json({ ok: true }));
  app.get('/cacheable', (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ok: true });
  });
  app.use((req, res) => res.status(404).json({ message: 'Not found' }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    return await fn((path) => fetch(`http://127.0.0.1:${port}${path}`));
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('sends the full header set on a normal response', async () => {
  await withApp({ NODE_ENV: 'production' }, async (get) => {
    const h = (await get('/data')).headers;
    const csp = h.get('content-security-policy').split(';').map((d) => d.trim()).sort();
    assert.deepEqual(csp, [
      "base-uri 'none'",
      "default-src 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ]);
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('x-frame-options'), 'DENY');
    assert.equal(h.get('referrer-policy'), 'no-referrer');
    assert.equal(h.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(h.get('cross-origin-resource-policy'), 'same-site');
    assert.equal(h.get('x-xss-protection'), '0');
    assert.equal(h.get('cache-control'), 'no-store');
    assert.equal(h.get('x-powered-by'), null, 'must not advertise Express');
  });
});

test('Permissions-Policy disables powerful features', async () => {
  await withApp({ NODE_ENV: 'production' }, async (get) => {
    const pp = (await get('/data')).headers.get('permissions-policy');
    for (const f of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      assert.match(pp, new RegExp(`${f}=\\(\\)`));
    }
  });
});

test('HSTS: 2 years + subdomains in production, no preload by default', async () => {
  await withApp({ NODE_ENV: 'production' }, async (get) => {
    const hsts = (await get('/data')).headers.get('strict-transport-security');
    assert.equal(hsts, 'max-age=63072000; includeSubDomains');
  });
});

test('HSTS preload only when explicitly requested', async () => {
  await withApp({ NODE_ENV: 'production', HSTS_PRELOAD: 'true' }, async (get) => {
    const hsts = (await get('/data')).headers.get('strict-transport-security');
    assert.match(hsts, /preload/);
  });
});

test('no HSTS outside production', async () => {
  await withApp({ NODE_ENV: 'development' }, async (get) => {
    assert.equal((await get('/data')).headers.get('strict-transport-security'), null);
  });
});

test('headers are also present on 404 responses', async () => {
  await withApp({ NODE_ENV: 'production' }, async (get) => {
    const res = await get('/nope');
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

test('a route can still override the no-store default', async () => {
  await withApp({ NODE_ENV: 'production' }, async (get) => {
    const res = await get('/cacheable');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
  });
});
