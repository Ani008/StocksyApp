// Security review item 13 (client half): duplicate-order protection.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  newIdempotencyKey,
  isAmbiguousFailure,
  orderIntent,
  createOrderAttempt,
} from "../services/idempotency.js";
import { placeOrder } from "../services/orderService.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const state = globalThis.__stubState;

// ── key generation ──────────────────────────────────────────────────────────
test("keys are valid v4 UUIDs, from randomUUID, getRandomValues or Math.random", () => {
  assert.match(newIdempotencyKey(globalThis.crypto), UUID_V4);
  // React Native: App.js loads react-native-get-random-values, which has no randomUUID
  const rnCrypto = { getRandomValues: (a) => globalThis.crypto.getRandomValues(a) };
  assert.match(newIdempotencyKey(rnCrypto), UUID_V4);
  assert.match(newIdempotencyKey(null), UUID_V4);
});

test("keys do not collide, and always satisfy the server's format rule", () => {
  const rnCrypto = { getRandomValues: (a) => globalThis.crypto.getRandomValues(a) };
  const keys = new Set(Array.from({ length: 5000 }, () => newIdempotencyKey(rnCrypto)));
  assert.equal(keys.size, 5000);
  for (const k of keys) assert.match(k, /^[A-Za-z0-9_.:-]{8,80}$/); // server KEY_RE
});

// ── which failures keep the key ─────────────────────────────────────────────
test("only unknown-outcome failures are ambiguous", () => {
  assert.equal(isAmbiguousFailure({ request: {}, message: "timeout of 10000ms exceeded" }), true, "timeout");
  assert.equal(isAmbiguousFailure({ message: "Network Error" }), true, "offline");
  for (const s of [500, 502, 503, 504, 408]) assert.equal(isAmbiguousFailure({ response: { status: s } }), true, String(s));
  for (const s of [400, 401, 403, 404, 422, 429]) assert.equal(isAmbiguousFailure({ response: { status: s } }), false, String(s));
});

// ── the attempt: when the key is kept and when it rotates ───────────────────
const buy = (over = {}) => ({
  wallet_id: "w1", instrument_key: "NSE_EQ|X", symbol: "X", order_type: "LIMIT",
  side: "BUY", quantity: 10, price: 100, product_type: "CNC", ...over,
});
const counting = () => { let n = 0; return { generate: () => `key-${++n}-padding`, count: () => n }; };

test("a double tap / retry of the same order reuses ONE key", () => {
  const g = counting();
  const a = createOrderAttempt({ generate: g.generate });
  const k1 = a.keyFor(buy());
  assert.equal(a.keyFor(buy()), k1);
  assert.equal(a.keyFor(buy()), k1);
  assert.equal(g.count(), 1);
});

test("a MARKET order keeps its key while the live price ticks between tap and retry", () => {
  const a = createOrderAttempt();
  const m = (price) => buy({ order_type: "MARKET", price });
  const k = a.keyFor(m(2500.1));
  assert.equal(a.keyFor(m(2500.35)), k);
  assert.equal(a.keyFor(m(2499.9)), k);
});

test("changing the order (qty, side, symbol, limit price, wallet...) gets a NEW key", () => {
  for (const change of [{ quantity: 11 }, { side: "SELL" }, { symbol: "Y" }, { instrument_key: "NSE_EQ|Y" }, { price: 101 }, { wallet_id: "w2" }, { product_type: "MIS" }, { order_type: "SL", trigger_price: 99 }]) {
    const a = createOrderAttempt();
    const k = a.keyFor(buy());
    assert.notEqual(a.keyFor(buy(change)), k, JSON.stringify(change));
  }
});

test("success starts the next order on a fresh key", () => {
  const a = createOrderAttempt();
  const k = a.keyFor(buy());
  a.succeeded();
  assert.notEqual(a.keyFor(buy()), k);
});

test("after a timeout / 5xx the key is KEPT, so the retry cannot place a second order", () => {
  for (const err of [{ message: "timeout of 10000ms exceeded", request: {} }, { response: { status: 502 } }, { response: { status: 504 } }]) {
    const a = createOrderAttempt();
    const k = a.keyFor(buy());
    a.failed(err);
    assert.equal(a.keyFor(buy()), k, JSON.stringify(err));
  }
});

test("after a definite rejection (4xx) the key is dropped: nothing was placed", () => {
  for (const status of [400, 422, 429]) {
    const a = createOrderAttempt();
    const k = a.keyFor(buy());
    a.failed({ response: { status } });
    assert.notEqual(a.keyFor(buy()), k, String(status));
  }
});

test("reset() forgets the key", () => {
  const a = createOrderAttempt();
  const k = a.keyFor(buy());
  a.reset();
  assert.notEqual(a.keyFor(buy()), k);
});

// ── client and server must agree on what "the same order" means ─────────────
test("client intent matches the server fingerprint for every kind of change", () => {
  const server = createRequire(import.meta.url)("../../Stocksy_Server/utils/idempotency.js");
  const base = buy();
  const variants = [
    base,
    { ...base, quantity: "10", price: "100.00" },
    { ...base, name: "Other", metadata: { a: 1 } },
    { ...base, quantity: 11 }, { ...base, price: 101 }, { ...base, side: "SELL" },
    { ...base, symbol: "Y" }, { ...base, product_type: "MIS" }, { ...base, trigger_price: 99 },
    { ...base, order_type: "MARKET", price: 100 }, { ...base, order_type: "MARKET", price: 100.7 },
    { ...base, order_type: "MARKET", price: undefined },
    { ...base, order_type: "SL_M", trigger_price: 95, price: 1 }, { ...base, order_type: "SL_M", trigger_price: 95, price: 2 },
    { ...base, order_type: "SL_M", trigger_price: 94 },
    { ...base, order_type: "SL", trigger_price: 99 }, { ...base, order_type: "SL", trigger_price: 98 },
    { ...base, wallet_id: "w2" },
  ];
  const sFp = (p) => server.fingerprintOrder(p.wallet_id, p);
  for (const a of variants) for (const b of variants) {
    assert.equal(
      orderIntent(a) === orderIntent(b),
      sFp(a) === sFp(b),
      `client and server disagree about:\n${JSON.stringify(a)}\n${JSON.stringify(b)}`,
    );
  }
});

// ── what actually goes over the wire ────────────────────────────────────────
test("placeOrder sends the key as X-Idempotency-Key (a header the server's CORS allows)", async () => {
  state.posts.length = 0;
  state.responder = async () => ({ data: { order: { id: "o1" } } });
  const out = await placeOrder(buy(), { idempotencyKey: "abc-12345-key" });
  assert.deepEqual(out, { order: { id: "o1" } });
  assert.equal(state.posts[0].url, "/orders");
  assert.equal(state.posts[0].config.headers["X-Idempotency-Key"], "abc-12345-key");

  const cors = await import("node:fs").then((fs) => fs.readFileSync(new URL("../../Stocksy_Server/config/cors.js", import.meta.url), "utf8"));
  assert.ok(cors.includes('"X-Idempotency-Key"'), "browsers would block the header at preflight without this");
});

test("placeOrder without a key still works and sends no header (older call sites)", async () => {
  state.posts.length = 0;
  state.responder = async () => ({ data: {} });
  await placeOrder(buy());
  assert.equal(state.posts[0].config.headers, undefined);
});

test("every UI call site passes an idempotency key", async () => {
  const fs = await import("node:fs");
  for (const f of ["src/pages/Buyorderscreen.js", "src/components/IntradayPositionsView.js"]) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    const calls = [...src.matchAll(/\bplaceOrder\(([^;]*?)\);/gs)].map((m) => m[1]);
    assert.ok(calls.length > 0, f);
    for (const c of calls) assert.match(c, /idempotencyKey:/, `${f}: placeOrder(${c.slice(0, 40)}...) has no key`);
  }
});
