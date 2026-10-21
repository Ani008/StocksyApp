// Daily "Nifty opened +x%, your portfolio is +₹y" push. No DB / Redis / network:
// postgres, redis and webPushService are replaced with in-memory fakes.

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
let redisData = {};
const redisSetCalls = [];
stubModule("services/redisService.js", {
  get: async (k) => redisData[k] ?? null,
  mGet: async (keys) => keys.map((k) => redisData[k] ?? null),
  set: async (k, v, opts) => {
    redisSetCalls.push(k);
    if (opts && opts.NX && redisData[k] !== undefined) return null;
    redisData[k] = v;
    return "OK";
  },
});

let subscribedUsers = [];
let positionRows = [];
stubModule("config/postgres.js", {
  pool: {
    query: async (sql) => {
      if (sql.includes("push_subscriptions")) return { rows: subscribedUsers.map((u) => ({ user_id: u })) };
      if (sql.includes("FROM positions")) return { rows: positionRows };
      return { rows: [] };
    },
  },
});

let pushEnabled = true;
const pushed = [];
stubModule("services/webPushService.js", {
  isEnabled: () => pushEnabled,
  sendToUser: async (userId, message) => {
    pushed.push({ userId, message });
    return { sent: 1, removed: 0 };
  },
});

const svc = require("../services/dailySummaryService");

const tick = (ltp, cp) => JSON.stringify({ ltpc: { ltp, cp } });
// Wednesday 21 Oct 2026, 09:20 IST (a normal trading day)
const TRADING_DAY = new Date("2026-10-21T09:20:00+05:30");
const SATURDAY = new Date("2026-10-24T09:20:00+05:30");

function reset() {
  redisData = {};
  redisSetCalls.length = 0;
  subscribedUsers = [];
  positionRows = [];
  pushed.length = 0;
  pushEnabled = true;
  delete process.env.DAILY_SUMMARY_ENABLED;
}

// ── pure helpers ─────────────────────────────────────────────────────────────
test("formatPercent: sign, one decimal, flat", () => {
  assert.equal(svc.formatPercent(0.8), "+0.8%");
  assert.equal(svc.formatPercent(-1.234), "-1.2%");
  assert.equal(svc.formatPercent(0.04), "flat");
});

test("formatRupees: Indian grouping, sign, flat", () => {
  assert.equal(svc.formatRupees(2300), "+₹2,300");
  assert.equal(svc.formatRupees(-125000.4), "-₹1,25,000");
  assert.equal(svc.formatRupees(0.3), "flat");
});

test("parseTick rejects missing / zero / garbage", () => {
  assert.deepEqual(svc.parseTick(tick(101, 100)), { ltp: 101, cp: 100 });
  assert.equal(svc.parseTick(null), null);
  assert.equal(svc.parseTick(tick(0, 100)), null);
  assert.equal(svc.parseTick(tick(100, 0)), null);
  assert.equal(svc.parseTick("not json"), null);
});

test("portfolio day change: longs gain on a rise, shorts gain on a fall", () => {
  const ticks = { A: { ltp: 110, cp: 100 }, B: { ltp: 90, cp: 100 } };
  const long = svc.computePortfolioDayChange([{ instrument_key: "A", quantity: "10" }], ticks);
  assert.equal(long.amount, 100);
  const short = svc.computePortfolioDayChange([{ instrument_key: "B", quantity: "-10" }], ticks);
  assert.equal(short.amount, 100);
});

test("portfolio day change skips positions with no tick; null if none usable", () => {
  const ticks = { A: { ltp: 110, cp: 100 }, B: null };
  const mixed = svc.computePortfolioDayChange(
    [{ instrument_key: "A", quantity: 1 }, { instrument_key: "B", quantity: 5 }],
    ticks,
  );
  assert.equal(mixed.amount, 10);
  assert.equal(mixed.counted, 1);
  assert.equal(svc.computePortfolioDayChange([{ instrument_key: "B", quantity: 5 }], ticks), null);
  assert.equal(svc.computePortfolioDayChange([], ticks), null);
});

test("buildMessage: the headline example, close variant, no-holdings, flat", () => {
  assert.deepEqual(svc.buildMessage("open", 0.8, { amount: 2300 }), {
    title: "Nifty opened +0.8%",
    body: "Your portfolio is +₹2,300 today.",
    url: "/",
    tag: "daily-open",
  });
  const close = svc.buildMessage("close", -0.5, { amount: -900 });
  assert.equal(close.title, "Nifty closed -0.5%");
  assert.equal(close.body, "Your portfolio is -₹900 today.");
  assert.equal(svc.buildMessage("open", 0.8, null).body, "See what's moving on Stocksy.");
  assert.equal(svc.buildMessage("open", 0, { amount: 0 }).title, "Nifty opened flat");
  assert.equal(svc.buildMessage("open", 0, { amount: 0 }).body, "Your portfolio is flat today.");
});

// ── runner ───────────────────────────────────────────────────────────────────
test("run: sends each subscribed user their own portfolio number", async () => {
  reset();
  redisData["stock:NSE_INDEX|Nifty 50"] = tick(25200, 25000); // +0.8%
  redisData["stock:NSE_EQ|AAA"] = tick(110, 100);
  subscribedUsers = ["u1", "u2", "u3"];
  positionRows = [
    { user_id: "u1", instrument_key: "NSE_EQ|AAA", quantity: "230" }, // +2300
    { user_id: "u2", instrument_key: "NSE_EQ|AAA", quantity: "-10" }, // short: -100
    // u3 holds nothing
  ];

  const res = await svc.runDailySummary("open", TRADING_DAY);
  assert.deepEqual(res, { users: 3, sent: 3 });

  const byUser = Object.fromEntries(pushed.map((p) => [p.userId, p.message]));
  assert.equal(byUser.u1.title, "Nifty opened +0.8%");
  assert.equal(byUser.u1.body, "Your portfolio is +₹2,300 today.");
  assert.equal(byUser.u2.body, "Your portfolio is -₹100 today.");
  assert.equal(byUser.u3.body, "See what's moving on Stocksy.");
});

test("run: only once per kind per day (restart / second instance safe)", async () => {
  reset();
  redisData["stock:NSE_INDEX|Nifty 50"] = tick(25200, 25000);
  subscribedUsers = ["u1"];

  assert.equal((await svc.runDailySummary("open", TRADING_DAY)).sent, 1);
  assert.deepEqual(await svc.runDailySummary("open", TRADING_DAY), { skipped: "already-sent" });
  assert.equal(pushed.length, 1);
  // a different kind the same day is a separate slot
  assert.equal((await svc.runDailySummary("close", TRADING_DAY)).sent, 1);
});

test("run: skips weekends", async () => {
  reset();
  redisData["stock:NSE_INDEX|Nifty 50"] = tick(25200, 25000);
  subscribedUsers = ["u1"];
  assert.deepEqual(await svc.runDailySummary("open", SATURDAY), { skipped: "weekend" });
  assert.equal(pushed.length, 0);
});

test("run: no Nifty data -> sends nothing and does NOT burn today's slot", async () => {
  reset();
  subscribedUsers = ["u1"];
  assert.deepEqual(await svc.runDailySummary("open", TRADING_DAY), { skipped: "no-index-data" });
  assert.equal(pushed.length, 0);
  assert.equal(redisSetCalls.length, 0);
});

test("run: push disabled or kill switch -> nothing happens", async () => {
  reset();
  redisData["stock:NSE_INDEX|Nifty 50"] = tick(25200, 25000);
  subscribedUsers = ["u1"];

  pushEnabled = false;
  assert.deepEqual(await svc.runDailySummary("open", TRADING_DAY), { skipped: "push-disabled" });

  pushEnabled = true;
  process.env.DAILY_SUMMARY_ENABLED = "false";
  assert.deepEqual(await svc.runDailySummary("open", TRADING_DAY), { skipped: "disabled" });
  assert.equal(pushed.length, 0);
  delete process.env.DAILY_SUMMARY_ENABLED;
});
