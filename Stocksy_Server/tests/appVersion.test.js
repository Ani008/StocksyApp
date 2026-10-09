const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const {
  buildVersionResponse,
  VersionConfigError,
  DEFAULT_MESSAGE,
  MAX_MESSAGE_LENGTH,
} = require('../services/appVersionService');

test('returns android versions parsed from env', () => {
  const out = buildVersionResponse({ LATEST_ANDROID_VERSION: '6', MINIMUM_ANDROID_VERSION: '5' });
  assert.deepEqual(out, {
    android: { latestVersionCode: 6, minimumVersionCode: 5 },
    message: DEFAULT_MESSAGE,
  });
});

test('trims whitespace and accepts latest === minimum', () => {
  const out = buildVersionResponse({ LATEST_ANDROID_VERSION: ' 5 ', MINIMUM_ANDROID_VERSION: '5' });
  assert.deepEqual(out.android, { latestVersionCode: 5, minimumVersionCode: 5 });
});

test('custom message is used, trimmed and length-capped', () => {
  const base = { LATEST_ANDROID_VERSION: '6', MINIMUM_ANDROID_VERSION: '5' };
  assert.equal(
    buildVersionResponse({ ...base, APP_UPDATE_MESSAGE: '  Improved Trading Journal.  ' }).message,
    'Improved Trading Journal.'
  );
  assert.equal(
    buildVersionResponse({ ...base, APP_UPDATE_MESSAGE: 'x'.repeat(500) }).message.length,
    MAX_MESSAGE_LENGTH
  );
  assert.equal(buildVersionResponse({ ...base, APP_UPDATE_MESSAGE: '   ' }).message, DEFAULT_MESSAGE);
});

test('changing LATEST_ANDROID_VERSION is reflected without code changes', () => {
  const env = { LATEST_ANDROID_VERSION: '6', MINIMUM_ANDROID_VERSION: '5' };
  assert.equal(buildVersionResponse(env).android.latestVersionCode, 6);
  env.LATEST_ANDROID_VERSION = '7';
  assert.equal(buildVersionResponse(env).android.latestVersionCode, 7);
});

test('rejects missing, non-numeric, fractional, zero and negative values', () => {
  const bad = [undefined, '', 'abc', '6.5', '0', '-1', '1e3', '6abc'];
  for (const v of bad) {
    assert.throws(
      () => buildVersionResponse({ LATEST_ANDROID_VERSION: v, MINIMUM_ANDROID_VERSION: '1' }),
      VersionConfigError
    );
    assert.throws(
      () => buildVersionResponse({ LATEST_ANDROID_VERSION: '9', MINIMUM_ANDROID_VERSION: v }),
      VersionConfigError
    );
  }
});

test('rejects minimum greater than latest', () => {
  assert.throws(
    () => buildVersionResponse({ LATEST_ANDROID_VERSION: '5', MINIMUM_ANDROID_VERSION: '6' }),
    VersionConfigError
  );
});

function request(env, path = '/api/app/version') {
  const saved = {};
  for (const k of ['LATEST_ANDROID_VERSION', 'MINIMUM_ANDROID_VERSION', 'APP_UPDATE_MESSAGE']) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  const app = express();
  app.use('/api/app', require('../routes/appVersion'));
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
        const body = await res.json();
        resolve({ status: res.status, body, headers: res.headers });
      } catch (e) {
        reject(e);
      } finally {
        server.close();
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    });
  });
}

test('GET /api/app/version → 200 with public payload, no auth needed', async () => {
  const { status, body, headers } = await request({
    LATEST_ANDROID_VERSION: '6',
    MINIMUM_ANDROID_VERSION: '5',
    APP_UPDATE_MESSAGE: 'New version available with an improved Trading Journal.',
  });
  assert.equal(status, 200);
  assert.deepEqual(body, {
    android: { latestVersionCode: 6, minimumVersionCode: 5 },
    message: 'New version available with an improved Trading Journal.',
  });
  assert.match(headers.get('cache-control'), /max-age=60/);
});

test('response exposes nothing beyond android + message', async () => {
  process.env.JWT_SECRET = 'super-secret-should-never-leak';
  const { body } = await request({ LATEST_ANDROID_VERSION: '6', MINIMUM_ANDROID_VERSION: '5' });
  assert.deepEqual(Object.keys(body).sort(), ['android', 'message']);
  assert.ok(!JSON.stringify(body).includes('super-secret'));
  delete process.env.JWT_SECRET;
});

test('GET /api/app/version → 503 (safe body) when env is invalid', async () => {
  const { status, body, headers } = await request({
    LATEST_ANDROID_VERSION: 'oops',
    MINIMUM_ANDROID_VERSION: '5',
  });
  assert.equal(status, 503);
  assert.equal(body.code, 'APP_VERSION_UNAVAILABLE');
  assert.ok(!JSON.stringify(body).includes('oops'));
  assert.equal(headers.get('cache-control'), 'no-store');
});