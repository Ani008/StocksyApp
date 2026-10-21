// Market-open push ("Nifty opened +0.8%, your portfolio is +₹2,300").
// No Redis, Postgres or network: redis, the pool and the push sender are fakes.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.join(__dirname, "..");
const resolve = (rel) => require.resolve(path.join(root, rel));
function stubModule(rel, exportsObj) {
  const id = resolve(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj, children: [], paths: [] };
}

// ── fakes ────────────────────────────────────────────────────────────────────
let store = {}; // redis: key -> string
const redisFake = {
  get: async (k) => store[k] ?? null,
  set: async (k, v, opts) => {
    if (opts && opts.NX && k in store) return null;
    store[k] = v;
    return "OK";
  },
  mGet: async (keys) => keys.map((k) => store[k] ?? null),
};
stubModule("services/redisService.js", redisFake);

let subscribedUsers = [];
let positionRows = [];
stubModule("config/postgres.js", {
  pool: {
    query: async (sql) => {
      if (/FROM push_subscriptions/.test(sql)) return { rows: subscribedUsers.map((user_id) => ({ user_id })) };
      if (/FROM positions/.test(sql)) return { rows: positionRows };
      return { rows: [] };
    },
  },
});

let pushEnabled = true;
const pushed = []; // { userId, message }
stubModule("services/webPushService.js", {
  isEnabled: () => pushEnabled,
  sendToUser: async (userId, message) => {
    pushed.push({ userId, message });
    return { sent: 1, removed: 0 };
  },
});

const notifier = require("../services/marketOpenNotifier");

// Wed 21 Oct 2026, 09:20 IST (a trading day). Tue 20 Oct 2026 is Dussehra.
const TRADING_NOW = new Date("2026-10-21T09:20:00+05:30");
const HOLIDAY_NOW = new Date("2026-10-20T09:20:00+05:30");
const SATURDAY_NOW = new Date("2026-10-24T09:20:00+05:30");

const NIFTY = "NSE_INDEX|Nifty 50";
const RELIANCE = "NSE_EQ|INE002A01018";
const TCS = "NSE_EQ|INE467B01029";

function putQuote(key, ltp, cp, tickAt = TRADING_NOW) {
  store[`stock:${key}`] = JSON.stringify({ ltpc: { ltp, cp } });
  store[`stock_ts:${key}`] = String(tickAt.getTime() / 1000);
}

function reset() {
  store = {};
  subscribedUsers = [];
  positionRows = [];
  pushed.length = 0;
  pushEnabled = true;
}

// ── formatting ───────────────────────────────────────────────────────────────
test("formatPercent: sign, one decimal, flat near zero", () => {
  assert.equal(notifier.formatPercent(0.8), "+0.8%");
  assert.equal(notifier.formatPercent(-0.43), "-0.4%");
  assert.equal(notifier.formatPercent(0.04), "flat");
});

test("formatRupees: Indian digit grouping, sign, flat when it rounds to zero", () => {
  assert.equal(notifier.formatRupees(2300), "+₹2,300");
  assert.equal(notifier.formatRupees(-123456.4), "-₹1,23,456");
  assert.equal(notifier.formatRupees(0.3), "flat");
});

// ── the happy path ───────────────────────────────────────────────────────────
test("sends 'Nifty opened +0.8%' with the user's portfolio change", async () => {
  reset();
  putQuote(NIFTY, 25200, 25000); // +0.8%
  putQuote(RELIANCE, 1523, 1500); // +23
  subscribedUsers = ["u1"];
  positionRows = [{ user_id: "u1", instrument_key: RELIANCE, quantity: "100" }]; // +2,300

  const res = await notifier.runMarketOpenNotification({ now: TRADING_NOW });

  assert.equal(res.status, "sent");
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].userId, "u1");
  assert.equal(pushed[0].message.title, "Nifty opened +0.8%");
  assert.equal(pushed[0].message.body, "Your portfolio is +₹2,300 today");
  assert.equal(pushed[0].message.url, "/");
  assert.equal(pushed[0].message.tag, "market-open-2026-10-21");
});

test("sums several positions; a short position gains when the price falls", async () => {
  reset();
  putQuote(NIFTY, 24950, 25000); // -0.2%
  putQuote(RELIANCE, 1510, 1500); // long 100  -> +1,000
  putQuote(TCS, 3950, 4000); // short 10 (qty -10) -> +500
  subscribedUsers = ["u1"];
  positionRows = [
    { user_id: "u1", instrument_key: RELIANCE, quantity: "100" },
    { user_id: "u1", instrument_key: TCS, quantity: "-10" },
  ];

  await notifier.runMarketOpenNotification({ now: TRADING_NOW });

  assert.equal(pushed[0].message.title, "Nifty opened -0.2%");
  assert.equal(pushed[0].message.body, "Your portfolio is +₹1,500 today");
});

test("negative day reads as a loss", async () => {
  reset();
  putQuote(NIFTY, 24900, 25000);
  putQuote(RELIANCE, 1488, 1500);
  subscribedUsers = ["u1"];
  positionRows = [{ user_id: "u1", instrument_key: RELIANCE, quantity: "100" }];

  await notifier.runMarketOpenNotification({ now: TRADING_NOW });
  assert.equal(pushed[0].message.body, "Your portfolio is -₹1,200 today");
});

test("user with no positions still gets the Nifty line, without a made-up portfolio figure", async () => {
  reset();
  putQuote(NIFTY, 25200, 25000);
  subscribedUsers = ["u1", "u2"];
  positionRows = [];

  await notifier.runMarketOpenNotification({ now: TRADING_NOW });

  assert.equal(pushed.length, 2);
  assert.equal(pushed[0].message.title, "Nifty opened +0.8%");
  assert.doesNotMatch(pushed[0].message.body, /₹/);
});

test("each user gets their own figure", async () => {
  reset();
  putQuote(NIFTY, 25200, 25000);
  putQuote(RELIANCE, 1510, 1500);
  subscribedUsers = ["u1", "u2"];
  positionRows = [
    { user_id: "u1", instrument_key: RELIANCE, quantity: "10" }, // +100
    { user_id: "u2", instrument_key: RELIANCE, quantity: "50" }, // +500
  ];

  await notifier.runMarketOpenNotification({ now: TRADING_NOW });

  const byUser = Object.fromEntries(pushed.map((p) => [p.userId, p.message.body]));
  assert.equal(byUser.u1, "Your portfolio is +₹100 today");
  assert.equal(byUser.u2, "Your portfolio is +₹500 today");
});

// ── things that must NOT send ────────────────────────────────────────────────
test("does nothing on an exchange holiday (Dussehra) or a weekend", async () => {
  reset();
  putQuote(NIFTY, 25200, 25000, HOLIDAY_NOW);
  subscribedUsers = ["u1"];

  assert.equal((await notifier.runMarketOpenNotification({ now: HOLIDAY_NOW })).status, "not_trading_day");
  assert.equal((await notifier.runMarketOpenNotification({ now: SATURDAY_NOW })).status, "not_trading_day");
  assert.equal(pushed.length, 0);
});

test("refuses stale data: yesterday's price must never be sent as today's", async () => {
  reset();
  const yesterday = new Date(TRADING_NOW.getTime() - 20 * 3600 * 1000);
  putQuote(NIFTY, 25200, 25000, yesterday);
  subscribedUsers = ["u1"];

  const res = await notifier.runMarketOpenNotification({ now: TRADING_NOW });

  assert.equal(res.status, "no_fresh_data");
  assert.equal(pushed.length, 0);
  assert.equal(store["market_open_push:2026-10-21"], undefined); // not claimed -> next minute retries
});

test("a stale quote for one holding is ignored rather than trusted", async () => {
  reset();
  putQuote(NIFTY, 25200, 25000);
  putQuote(RELIANCE, 1510, 1500); // fresh, +100
  putQuote(TCS, 3000, 4000, new Date(TRADING_NOW.getTime() - 3600 * 1000)); // stale, would be -10,000
  subscribedUsers = ["u1"];
  positionRows = [
    { user_id: "u1", instrument_key: RELIANCE, quantity: "10" },
    { user_id: "u1", instrument_key: TCS, quantity: "10" },
  ];

  await notifier.runMarketOpenNotification({ now: TRADING_NOW });
  assert.equal(pushed[0].message.body, "Your portfolio is +₹100 today");
});

test("sends once per day even if the cron fires every minute", async () => {
  reset();
  putQuote(NIFTY, 25200, 25000);
  subscribedUsers = ["u1"];

  const first = await notifier.runMarketOpenNotification({ now: TRADING_NOW });
  const second = await notifier.runMarketOpenNotification({ now: new Date(TRADING_NOW.getTime() + 60000) });

  assert.equal(first.status, "sent");
  assert.equal(second.status, "already_sent");
  assert.equal(pushed.length, 1);
});

test("a lost claim race (another instance won) sends nothing", async () => {
  reset();
  putQuote(NIFTY, 25200, 25000);
  subscribedUsers = ["u1"];
  // The other instance claims between our read and our SET NX.
  const realGet = redisFake.get;
  redisFake.get = async () => null;
  store["market_open_push:2026-10-21"] = "1";
  const res = await notifier.runMarketOpenNotification({ now: TRADING_NOW });
  redisFake.get = realGet;

  assert.equal(res.status, "already_sent");
  assert.equal(pushed.length, 0);
});

test("does nothing when web push is not configured", async () => {
  reset();
  pushEnabled = false;
  putQuote(NIFTY, 25200, 25000);
  subscribedUsers = ["u1"];

  assert.equal((await notifier.runMarketOpenNotification({ now: TRADING_NOW })).status, "push_disabled");
  assert.equal(pushed.length, 0);
});
