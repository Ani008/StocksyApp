import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUSH_STATE,
  derivePushState,
  parseOpenTarget,
  targetFromUrl,
  subscriptionToBody,
  urlBase64ToUint8Array,
} from "../src/utils/push.js";

// ── derivePushState ─────────────────────────────────────────────────────────
const base = { supported: true, serverEnabled: true, permission: "default", hasSubscription: false };

test("iOS in a normal Safari tab needs the app installed first", () => {
  assert.equal(derivePushState({ ...base, supported: false, isIos: true, standalone: false }), PUSH_STATE.NEEDS_INSTALL);
  // even if some API appears present, an uninstalled iOS tab still says install
  assert.equal(derivePushState({ ...base, isIos: true, standalone: false }), PUSH_STATE.NEEDS_INSTALL);
});

test("installed iOS app behaves like any other browser", () => {
  assert.equal(derivePushState({ ...base, isIos: true, standalone: true }), PUSH_STATE.OFF);
});

test("unsupported browser, server off, blocked, off, on", () => {
  assert.equal(derivePushState({ ...base, supported: false }), PUSH_STATE.UNSUPPORTED);
  assert.equal(derivePushState({ ...base, serverEnabled: false }), PUSH_STATE.UNAVAILABLE);
  assert.equal(derivePushState({ ...base, permission: "denied" }), PUSH_STATE.BLOCKED);
  assert.equal(derivePushState({ ...base }), PUSH_STATE.OFF);
  assert.equal(derivePushState({ ...base, permission: "granted", hasSubscription: false }), PUSH_STATE.OFF);
  assert.equal(derivePushState({ ...base, permission: "granted", hasSubscription: true }), PUSH_STATE.ON);
});

// ── key + body helpers ──────────────────────────────────────────────────────
test("urlBase64ToUint8Array decodes base64url with and without padding", () => {
  const bytes = [251, 255, 190, 1, 2, 3, 250];
  const b64url = Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.deepEqual([...urlBase64ToUint8Array(b64url)], bytes);
});

test("subscriptionToBody keeps only endpoint and keys", () => {
  const sub = { toJSON: () => ({ endpoint: "https://push.example/abc", expirationTime: null, keys: { p256dh: "P", auth: "A" } }) };
  assert.deepEqual(subscriptionToBody(sub), { endpoint: "https://push.example/abc", keys: { p256dh: "P", auth: "A" } });
});

// ── notification targets ────────────────────────────────────────────────────
test("open targets map to screens; unknown ones open nothing", () => {
  assert.equal(parseOpenTarget("?open=alerts"), "Alerts");
  assert.equal(parseOpenTarget("?x=1&open=orders"), "OrderHistory");
  assert.equal(parseOpenTarget("?open=ALERTS"), "Alerts");
  assert.equal(parseOpenTarget("?open=Login"), null);
  assert.equal(parseOpenTarget("?open=__proto__"), null);
  assert.equal(parseOpenTarget(""), null);
  assert.equal(targetFromUrl("/?open=alerts"), "Alerts");
  assert.equal(targetFromUrl("/"), null);
});

// ── the real public/sw.js push handlers, run in a fake worker scope ─────────
const here = path.dirname(fileURLToPath(import.meta.url));
const swSource = fs.readFileSync(path.join(here, "../public/sw.js"), "utf8");

function loadWorker({ windows = [] } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const self = {
    location: { origin: "https://app.stocksy.test" },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    registration: { showNotification: async (title, opts) => { shown.push({ title, opts }); } },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url) => { opened.push(url); },
      claim: async () => {},
    },
    skipWaiting() {},
  };
  vm.runInNewContext(swSource, { self, URL, caches: {}, fetch: async () => {}, Response: class {}, console });
  const run = async (type, event) => {
    let pending;
    listeners[type]({ ...event, waitUntil: (p) => { pending = p; } });
    await pending;
  };
  return { run, shown, opened };
}

const pushEvent = (json) => ({ data: { json: () => json } });

test("push shows a notification with title, body, tag and a same-origin url", async () => {
  const w = loadWorker();
  await w.run("push", pushEvent({ title: "TCS hit your target", body: "TCS is up to ₹4000", url: "/?open=alerts", tag: "alert-1" }));
  assert.equal(w.shown.length, 1);
  assert.equal(w.shown[0].title, "TCS hit your target");
  assert.equal(w.shown[0].opts.body, "TCS is up to ₹4000");
  assert.equal(w.shown[0].opts.tag, "alert-1");
  assert.equal(w.shown[0].opts.renotify, true);
  assert.equal(w.shown[0].opts.data.url, "/?open=alerts");
});

test("push ALWAYS shows something, even with no or broken payload", async () => {
  const w = loadWorker();
  await w.run("push", { data: null });
  await w.run("push", { data: { json: () => { throw new Error("bad json"); } } });
  await w.run("push", pushEvent({ title: 42, body: { x: 1 } }));
  assert.equal(w.shown.length, 3);
  for (const n of w.shown) assert.equal(n.title, "Stocksy");
  assert.equal(w.shown[2].opts.body, "");
});

test("a payload url pointing off-site is replaced with the app root", async () => {
  const w = loadWorker();
  for (const url of ["https://evil.example/", "//evil.example/", "javascript:alert(1)", undefined]) {
    await w.run("push", pushEvent({ title: "x", url }));
  }
  assert.deepEqual(w.shown.map((n) => n.opts.data.url), ["/", "/", "/", "/"]);
});

test("tapping a notification focuses an open app window and tells it where to go", async () => {
  const msgs = [];
  let focused = 0;
  const win = { url: "https://app.stocksy.test/", focus: async () => { focused += 1; }, postMessage: (m) => msgs.push(m) };
  const w = loadWorker({ windows: [win] });
  let closed = 0;
  await w.run("notificationclick", { notification: { close: () => { closed += 1; }, data: { url: "/?open=orders" } } });
  assert.equal(closed, 1);
  assert.equal(focused, 1);
  // JSON round-trip: the message object is created inside the vm realm.
  assert.deepEqual(JSON.parse(JSON.stringify(msgs)), [{ type: "NOTIFICATION_CLICK", url: "/?open=orders" }]);
  assert.deepEqual(w.opened, []);
});

test("tapping with no app window open opens one at the target url", async () => {
  const w = loadWorker({ windows: [] });
  await w.run("notificationclick", { notification: { close() {}, data: { url: "/?open=alerts" } } });
  assert.deepEqual(w.opened, ["/?open=alerts"]);
});

test("tapping ignores windows from other origins and a tampered url", async () => {
  const other = { url: "https://other.example/", focus: async () => { throw new Error("must not focus"); }, postMessage() {} };
  const w = loadWorker({ windows: [other] });
  await w.run("notificationclick", { notification: { close() {}, data: { url: "https://evil.example/" } } });
  assert.deepEqual(w.opened, ["/"]);
});
