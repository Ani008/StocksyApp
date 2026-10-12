// Web push (server side). No database, Redis or network: the subscription
// repository is an in-memory fake and web-push's sendNotification is replaced.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const webpush = require("web-push");

const root = path.join(__dirname, "..");
const resolve = (rel) => require.resolve(path.join(root, rel));
function stubModule(rel, exportsObj) {
  const id = resolve(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj, children: [], paths: [] };
}

stubModule("config/postgres.js", { pool: { query: async () => ({ rows: [] }) } });

// ── fakes ────────────────────────────────────────────────────────────────────
let subsByUser = {};
const deleted = [];
const upserts = [];
let repoShouldThrow = false;
stubModule("repositories/pushSubscriptionRepository.js", {
  listForUser: async (u) => {
    if (repoShouldThrow) throw new Error("db down");
    return subsByUser[u] || [];
  },
  deleteById: async (id) => { deleted.push(id); },
  markSuccess: async () => {},
  upsertSubscription: async (a) => { upserts.push(a); return { id: "x" }; },
  deleteByEndpoint: async () => 1,
});

const sent = [];
let sendImpl = async () => {};
webpush.sendNotification = async (sub, payload, opts) => { sent.push({ sub, payload, opts }); return sendImpl(sub); };

const keys = webpush.generateVAPIDKeys();
function configure(env) {
  for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "WEB_PUSH_ENABLED"]) delete process.env[k];
  Object.assign(process.env, env);
  const svc = require("../services/webPushService");
  svc._reset();
  sent.length = 0; deleted.length = 0;
  return svc;
}
const ENABLED = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:a@b.co" };
const sub = (id) => ({ id, endpoint: `https://push.example/${id}`, p256dh: "P", auth: "A" });

test("disabled without VAPID keys: nothing is sent and the DB is not touched", async () => {
  const svc = configure({});
  subsByUser = { u1: [sub("a")] };
  repoShouldThrow = true; // would throw if the service touched the repo
  assert.deepEqual(await svc.sendToUser("u1", { title: "t" }), { sent: 0, removed: 0 });
  assert.equal(sent.length, 0);
  assert.equal(svc.getPublicKey(), null);
  repoShouldThrow = false;
});

test("WEB_PUSH_ENABLED=false is a kill switch even with valid keys", async () => {
  const svc = configure({ ...ENABLED, WEB_PUSH_ENABLED: "false" });
  subsByUser = { u1: [sub("a")] };
  await svc.sendToUser("u1", { title: "t" });
  assert.equal(sent.length, 0);
  assert.equal(svc.isEnabled(), false);
});

test("garbage VAPID keys disable push instead of crashing", () => {
  const svc = configure({ VAPID_PUBLIC_KEY: "nope", VAPID_PRIVATE_KEY: "nope", VAPID_SUBJECT: "mailto:a@b.co" });
  assert.equal(svc.isEnabled(), false);
});

test("sends to every device of the user with high urgency and a short TTL", async () => {
  const svc = configure(ENABLED);
  subsByUser = { u1: [sub("a"), sub("b")], u2: [sub("c")] };
  const r = await svc.sendToUser("u1", { title: "TCS hit", body: "up", url: "/?open=alerts", tag: "alert-1" });
  assert.equal(r.sent, 2);
  assert.deepEqual(sent.map((s) => s.sub.endpoint).sort(), ["https://push.example/a", "https://push.example/b"]);
  assert.equal(sent[0].opts.urgency, "high");
  assert.equal(sent[0].opts.TTL, 600);
  assert.deepEqual(JSON.parse(sent[0].payload), { title: "TCS hit", body: "up", url: "/?open=alerts", tag: "alert-1" });
  assert.equal(svc.getPublicKey(), keys.publicKey);
});

test("404/410 prunes the dead subscription; other errors keep it", async () => {
  const svc = configure(ENABLED);
  subsByUser = { u1: [sub("gone"), sub("flaky"), sub("ok")] };
  sendImpl = async (s) => {
    if (s.endpoint.endsWith("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    if (s.endpoint.endsWith("flaky")) throw Object.assign(new Error("boom"), { statusCode: 500 });
  };
  const r = await svc.sendToUser("u1", { title: "t" });
  assert.deepEqual(r, { sent: 1, removed: 1 });
  assert.deepEqual(deleted, ["gone"]);
  sendImpl = async () => {};
});

test("sendToUser never throws, even if the database is down", async () => {
  const svc = configure(ENABLED);
  repoShouldThrow = true;
  assert.deepEqual(await svc.sendToUser("u1", { title: "t" }), { sent: 0, removed: 0 });
  repoShouldThrow = false;
  svc.notifyUser("u1", { title: "t" }); // fire and forget must not throw either
});

test("payload is trimmed and off-site urls are replaced", () => {
  const svc = configure(ENABLED);
  const p = JSON.parse(svc.buildPayload({ title: "x".repeat(500), body: "y".repeat(500), url: "https://evil.example" }));
  assert.equal(p.title.length, 80);
  assert.equal(p.body.length, 160);
  assert.equal(p.url, "/");
  assert.equal(JSON.parse(svc.buildPayload({ title: "t", url: "//evil.example" })).url, "/");
});

// ── controller ───────────────────────────────────────────────────────────────
function call(handler, { body, user = { id: "u1" } } = {}) {
  return new Promise((resolveCall) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolveCall({ status: this.statusCode, body: b }); },
    };
    handler({ body, user, headers: { "user-agent": "UA" } }, res);
  });
}
const validBody = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BNc-_abc123", auth: "xY_-9" } };

test("public-key endpoint reports disabled / enabled", async () => {
  const ctrl = require("../controllers/pushController");
  configure({});
  assert.deepEqual((await call(ctrl.publicKeyHandler)).body, { enabled: false, publicKey: null });
  configure(ENABLED);
  assert.deepEqual((await call(ctrl.publicKeyHandler)).body, { enabled: true, publicKey: keys.publicKey });
});

test("subscribe: 503 when push is off, 400 for bad input, 201 and stored for the caller", async () => {
  const ctrl = require("../controllers/pushController");
  configure({});
  assert.equal((await call(ctrl.subscribeHandler, { body: validBody })).status, 503);

  configure(ENABLED);
  upserts.length = 0;
  const bad = [
    undefined,
    {},
    { ...validBody, endpoint: "http://insecure.example/x" },
    { ...validBody, endpoint: "not a url" },
    { ...validBody, endpoint: "https://x.example/" + "a".repeat(1100) },
    { ...validBody, keys: { p256dh: "ok", auth: "bad key!" } },
    { ...validBody, keys: {} },
    { ...validBody, keys: { p256dh: "a".repeat(300), auth: "ok" } },
  ];
  for (const body of bad) assert.equal((await call(ctrl.subscribeHandler, { body })).status, 400, JSON.stringify(body)?.slice(0, 60));
  assert.equal(upserts.length, 0);

  const ok = await call(ctrl.subscribeHandler, { body: validBody, user: { id: "u9" } });
  assert.equal(ok.status, 201);
  assert.equal(upserts[0].userId, "u9"); // always the authenticated user, never a body field
  assert.equal(upserts[0].endpoint, validBody.endpoint);
  assert.equal(upserts[0].userAgent, "UA");
});

test("unsubscribe validates the endpoint", async () => {
  const ctrl = require("../controllers/pushController");
  assert.equal((await call(ctrl.unsubscribeHandler, { body: { endpoint: "x" } })).status, 400);
  assert.equal((await call(ctrl.unsubscribeHandler, { body: { endpoint: validBody.endpoint } })).status, 200);
});

// ── wiring: the routes require login where they should ───────────────────────
test("subscribe/unsubscribe are behind protect; public-key is not", () => {
  const router = require("../routes/push");
  const layers = router.stack.filter((l) => l.route).map((l) => ({
    path: l.route.path,
    handlers: l.route.stack.length,
  }));
  assert.deepEqual(layers.find((l) => l.path === "/public-key").handlers, 1);
  assert.equal(layers.find((l) => l.path === "/subscribe").handlers, 2);
  assert.equal(layers.find((l) => l.path === "/unsubscribe").handlers, 2);
});
