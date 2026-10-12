import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createMarketSocket, DEFAULTS } from "../services/marketSocketCore.js";

// ── test doubles ─────────────────────────────────────────────────────────────

class FakeWS {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    FakeWS.instances.push(this);
  }
  // test controls
  serverOpen() {
    this.readyState = 1;
    this.onopen && this.onopen();
  }
  serverSend(obj) {
    this.onmessage && this.onmessage({ data: JSON.stringify(obj) });
  }
  serverClose() {
    this.readyState = 3;
    this.onclose && this.onclose();
  }
  // what the app calls
  close() {
    this.readyState = 3; // deliberate close: browsers fire onclose later, app has detached by then
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function makeEnv({ token = "tok1", online = true, state = "active", config } = {}) {
  FakeWS.instances = [];
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });

  const toasts = [];
  let tokenValue = token;
  let appStateNow = state;
  let onlineNow = online;
  const appListeners = new Set();
  const netListeners = new Set();

  const sock = createMarketSocket({
    url: "wss://x.test",
    getToken: async () => tokenValue,
    getTicket: async () => (tokenValue ? `ticket-for-${tokenValue}` : null),
    WebSocketImpl: FakeWS,
    appState: {
      current: () => appStateNow,
      subscribe: (fn) => {
        appListeners.add(fn);
        return () => appListeners.delete(fn);
      },
    },
    network: {
      isOnline: () => onlineNow,
      subscribe: (fn) => {
        netListeners.add(fn);
        return () => netListeners.delete(fn);
      },
    },
    onToast: (m, s) => toasts.push([m, s]),
    random: () => 0.5, // jitter factor exactly 1
    config,
  });

  return {
    sock,
    toasts,
    ws: () => FakeWS.instances[FakeWS.instances.length - 1],
    count: () => FakeWS.instances.length,
    setToken: (t) => {
      tokenValue = t;
    },
    setAppState: (next) => {
      appStateNow = next;
      appListeners.forEach((f) => f(next));
    },
    setOnline: (v) => {
      onlineNow = v;
      netListeners.forEach((f) => f(v));
    },
    // advance the fake clock and let any promise continuations run
    tick: async (ms) => {
      mock.timers.tick(ms);
      await flush();
    },
  };
}

// every test gets a clean fake clock
test.afterEach(() => mock.timers.reset());

// ── connection basics ────────────────────────────────────────────────────────

test("does not connect until a screen attaches, then connects once with the token", async () => {
  const env = makeEnv();
  await flush();
  assert.equal(env.count(), 0);

  env.sock.attach();
  await flush();
  assert.equal(env.count(), 1);
  assert.equal(env.ws().url, "wss://x.test?ticket=ticket-for-tok1");
});

test("several screens share ONE socket", async () => {
  const env = makeEnv();
  env.sock.attach();
  env.sock.attach();
  env.sock.attach();
  await flush();
  assert.equal(env.count(), 1);
});

test("connects anonymously (price feed only) when there is no token", async () => {
  const env = makeEnv({ token: null });
  env.sock.attach();
  await flush();
  assert.equal(env.ws().url, "wss://x.test");
});

test("MARKET_DATA is flattened into prices and marks the socket connected", async () => {
  const env = makeEnv();
  env.sock.attach();
  await flush();
  env.ws().serverOpen();
  env.ws().serverSend({
    type: "MARKET_DATA",
    timestamp: 111,
    data: {
      "NSE_EQ|X": {
        ltpc: { ltp: "101.5", cp: "100" },
        symbol: "X",
        name: "Ex Ltd",
        isLive: true,
      },
    },
  });
  const snap = env.sock.getSnapshot();
  assert.equal(snap.isConnected, true);
  assert.equal(snap.prices["NSE_EQ|X"].ltp, 101.5);
  assert.equal(snap.prices["NSE_EQ|X"].cp, 100);
  assert.equal(snap.prices["NSE_EQ|X"]._ts, 111);
  assert.equal(snap.prices["NSE_EQ|X"].sector, "Equity");
});

test("a server error message lands in snapshot.error", async () => {
  const env = makeEnv();
  env.sock.attach();
  await flush();
  env.ws().serverOpen();
  env.ws().serverSend({ error: "No data in Redis." });
  assert.equal(env.sock.getSnapshot().error, "No data in Redis.");
});

test("snapshot identity is stable when nothing changed (no needless re-renders)", async () => {
  const env = makeEnv();
  env.sock.attach();
  await flush();
  const a = env.sock.getSnapshot();
  env.setOnline(true); // already online
  assert.equal(env.sock.getSnapshot(), a);
});

// ── order pushes ─────────────────────────────────────────────────────────────

test("order events toast ONCE and reach EVERY attached screen", async () => {
  const env = makeEnv();
  const gotA = [];
  const gotB = [];
  env.sock.attach((m) => gotA.push(m));
  env.sock.attach((m) => gotB.push(m));
  await flush();
  env.ws().serverOpen();

  env.ws().serverSend({ type: "ORDER_FILLED", side: "BUY", quantity: 5, symbol: "TCS", fillPrice: 3500 });
  env.ws().serverSend({ type: "ORDER_REJECTED", reason: "Insufficient funds" });
  env.ws().serverSend({ type: "RMS_SQUARE_OFF", symbol: "INFY", lossRatio: 0.85 });

  assert.equal(env.toasts.length, 3);
  assert.deepEqual(env.toasts[0], ["BUY 5 TCS filled @ ₹3,500.00", "success"]);
  assert.deepEqual(env.toasts[1], ["Order rejected — Insufficient funds", "error"]);
  assert.deepEqual(env.toasts[2], ["INFY auto-squared off — loss reached 85% of margin", "warning"]);
  assert.deepEqual(gotA.map((m) => m.type), ["ORDER_FILLED", "ORDER_REJECTED", "RMS_SQUARE_OFF"]);
  assert.deepEqual(gotB.map((m) => m.type), ["ORDER_FILLED", "ORDER_REJECTED", "RMS_SQUARE_OFF"]);
});

test("a screen that detaches no longer receives events (and others still do)", async () => {
  const env = makeEnv();
  const gotA = [];
  const gotB = [];
  const detachA = env.sock.attach((m) => gotA.push(m));
  env.sock.attach((m) => gotB.push(m));
  await flush();
  env.ws().serverOpen();
  detachA();
  env.ws().serverSend({ type: "ORDER_FILLED", side: "SELL", quantity: 1, symbol: "X", fillPrice: 1 });
  assert.equal(gotA.length, 0);
  assert.equal(gotB.length, 1);
  assert.equal(env.count(), 1, "leaving one screen must NOT close the shared socket");
});

// ── reconnect with backoff ───────────────────────────────────────────────────

test("backs off 1s, 2s, 4s, 8s, 16s then caps at 30s", async () => {
  const env = makeEnv();
  env.sock.attach();
  await flush();
  env.ws().serverOpen();
  env.ws().serverClose(); // drop

  const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
  for (const d of delays) {
    const before = env.count();
    await env.tick(d - 1);
    assert.equal(env.count(), before, `no retry before ${d}ms`);
    await env.tick(1);
    assert.equal(env.count(), before + 1, `retry exactly at ${d}ms`);
    env.ws().serverClose(); // attempt fails before opening
  }
});

test("a successful connection resets the backoff", async () => {
  const env = makeEnv();
  env.sock.attach();
  await flush();
  env.ws().serverClose();
  await env.tick(1000); // attempt 2
  env.ws().serverClose();
  await env.tick(2000); // attempt 3
  env.ws().serverOpen(); // success
  env.ws().serverClose();

  const before = env.count();
  await env.tick(999);
  assert.equal(env.count(), before);
  await env.tick(1);
  assert.equal(env.count(), before + 1, "back to a 1s first retry");
});

// ── app lifecycle (background / foreground) ──────────────────────────────────

test("no retries while backgrounded; foreground reconnects immediately", async () => {
  const env = makeEnv();
  env.sock.attach();
  await flush();
  env.ws().serverOpen();
  env.setAppState("background");
  env.ws().serverClose();

  await env.tick(120000);
  assert.equal(env.count(), 1, "must not burn retries in the background");

  env.setAppState("active");
  await flush();
  assert.equal(env.count(), 2, "reconnect right away on foreground, no backoff wait");
});

test("zombie socket after wake: no data after resume -> reconnects", async () => {
  const env = makeEnv();
  env.sock.attach();
  await flush();
  env.ws().serverOpen();
  env.ws().serverSend({ error: "x" }); // last data at t0
  env.setAppState("background");
  await env.tick(30000);
  env.setAppState("active"); // socket still reports OPEN but is dead

  await env.tick(DEFAULTS.resumeCheckMs - 1);
  assert.equal(env.count(), 1);
  await env.tick(1);
  assert.equal(env.count(), 2, "forced a fresh socket");
});

test("healthy socket after wake (data arrives) is NOT reconnected", async () => {
  const env = makeEnv();
  env.sock.attach();
  await flush();
  env.ws().serverOpen();
  env.setAppState("background");
  await env.tick(30000);
  env.setAppState("active");
  await env.tick(800);
  env.ws().serverSend({ error: "tick" }); // server is alive
  await env.tick(10000);
  assert.equal(env.count(), 1);
});

// ── stale-socket watchdog ────────────────────────────────────────────────────

test("watchdog replaces a socket that went silent", async () => {
  const env = makeEnv();
  env.sock.attach();
  await flush();
  env.ws().serverOpen();
  await env.tick(DEFAULTS.staleMs + DEFAULTS.watchdogMs);
  assert.equal(env.count(), 2);
});

test("watchdog leaves a socket alone while data keeps flowing", async () => {
  const env = makeEnv();
  env.sock.attach();
  await flush();
  env.ws().serverOpen();
  for (let i = 0; i < 90; i++) {
    await env.tick(800);
    env.ws().serverSend({ error: "tick" });
  }
  assert.equal(env.count(), 1);
});

// ── network (web) ────────────────────────────────────────────────────────────

test("offline: closes at once, shows offline, and reconnects instantly when back online", async () => {
  const env = makeEnv();
  env.sock.attach();
  await flush();
  env.ws().serverOpen();
  assert.equal(env.sock.getSnapshot().isConnected, true);

  env.setOnline(false);
  const snap = env.sock.getSnapshot();
  assert.equal(snap.isOnline, false);
  assert.equal(snap.isConnected, false);
  assert.equal(env.ws().readyState, 3);

  await env.tick(29000);
  assert.equal(env.count(), 1, "does not hammer while offline");

  env.setOnline(true);
  await flush();
  assert.equal(env.count(), 2, "reconnects immediately when the network returns");
  assert.equal(env.sock.getSnapshot().isOnline, true);
});

test("offline: slow 30s probe is the safety net if the browser never fires `online`", async () => {
  const env = makeEnv();
  env.sock.attach();
  await flush();
  env.ws().serverOpen();
  env.setOnline(false); // browser says offline; `online` never fires afterwards
  assert.equal(env.count(), 1);

  await env.tick(DEFAULTS.backoffMaxMs - 1);
  assert.equal(env.count(), 1, "quiet until the probe is due");
  await env.tick(1);
  assert.equal(env.count(), 2, "one slow probe attempt");

  // the probe fails (still offline): it must stay slow, never speed up
  env.ws().serverClose();
  await env.tick(DEFAULTS.backoffMaxMs - 1);
  assert.equal(env.count(), 2);
  await env.tick(1);
  assert.equal(env.count(), 3);
});

// ── resync after gaps ────────────────────────────────────────────────────────

test("RESYNC after a reconnect, but NOT on the very first connect", async () => {
  const env = makeEnv();
  const events = [];
  env.sock.attach((m) => events.push(m));
  await flush();
  env.ws().serverOpen();
  assert.deepEqual(events, []);

  env.ws().serverClose();
  await env.tick(1000);
  env.ws().serverOpen();
  assert.deepEqual(events.map((e) => [e.type, e.reason]), [["RESYNC", "reconnected"]]);
});

test("RESYNC on resume after a long background; none after a brief one", async () => {
  const env = makeEnv();
  const events = [];
  env.sock.attach((m) => events.push(m));
  await flush();
  env.ws().serverOpen();

  env.setAppState("background");
  await env.tick(2000);
  env.setAppState("active");
  assert.equal(events.length, 0, "short hide: no resync");
  await env.tick(800);
  env.ws().serverSend({ error: "tick" });

  env.setAppState("background");
  await env.tick(30000);
  env.setAppState("active");
  assert.deepEqual(events.map((e) => e.reason), ["resumed"]);
});

// ── idle shutdown ────────────────────────────────────────────────────────────

test("closes after the idle grace once the last screen leaves; re-attach within grace reuses it", async () => {
  const env = makeEnv();
  const detach = env.sock.attach();
  await flush();
  env.ws().serverOpen();

  detach();
  await env.tick(DEFAULTS.idleGraceMs - 1);
  assert.equal(env.ws().readyState, 1, "still open inside the grace window");

  const detach2 = env.sock.attach(); // quick tab switch / remount
  // keep the (fake) server talking so the stale-socket watchdog stays quiet
  for (let i = 0; i < 25; i++) {
    await env.tick(800);
    env.ws().serverSend({ error: "tick" });
  }
  assert.equal(env.count(), 1, "same socket reused, past the original idle deadline");
  assert.equal(env.ws().readyState, 1);

  // now really leave
  detach2();
  await env.tick(DEFAULTS.idleGraceMs);
  assert.equal(env.ws().readyState, 3);
});

test("fully idle: socket is closed, nothing retries, next attach reconnects", async () => {
  const env = makeEnv();
  const detach = env.sock.attach();
  await flush();
  env.ws().serverOpen();
  detach();
  await env.tick(DEFAULTS.idleGraceMs);
  assert.equal(env.ws().readyState, 3);
  assert.equal(env.sock.getSnapshot().isConnected, false);
  assert.equal(env.sock.getSnapshot().active, false);

  await env.tick(120000);
  assert.equal(env.count(), 1, "no background retries while idle");

  env.sock.attach();
  await flush();
  assert.equal(env.count(), 2);
});

// ── identity (login / logout) ────────────────────────────────────────────────

test("resetIdentity() reconnects with the new user's token (never the old one)", async () => {
  const env = makeEnv({ token: "alice" });
  env.sock.attach();
  await flush();
  env.ws().serverOpen();
  assert.match(env.ws().url, /ticket=ticket-for-alice$/);

  env.setToken("bob");
  env.sock.resetIdentity();
  await flush();
  assert.equal(env.count(), 2);
  assert.match(env.ws().url, /ticket=ticket-for-bob$/);
  assert.equal(FakeWS.instances[0].readyState, 3, "alice's socket is closed");
});

test("logout: reconnects anonymously", async () => {
  const env = makeEnv({ token: "alice" });
  env.sock.attach();
  await flush();
  env.ws().serverOpen();
  env.setToken(null);
  env.sock.resetIdentity();
  await flush();
  assert.equal(env.ws().url, "wss://x.test");
});

test("logout then quick login by someone else (inside the idle grace) does not reuse the old identity", async () => {
  const env = makeEnv({ token: "alice" });
  const detach = env.sock.attach();
  await flush();
  env.ws().serverOpen();

  detach(); // MainTabs unmounts on logout
  env.setToken("bob"); // bob logs in a moment later, before the idle grace ends
  env.sock.attach(); // new MainTabs mounts
  await flush();
  assert.equal(env.count(), 2);
  assert.match(env.ws().url, /ticket=ticket-for-bob$/);
});

test("late events from a replaced socket are ignored", async () => {
  const env = makeEnv({ token: "alice" });
  const got = [];
  env.sock.attach((m) => got.push(m));
  await flush();
  const old = env.ws();
  old.serverOpen();
  env.setToken("bob");
  env.sock.resetIdentity();
  await flush();
  env.ws().serverOpen();

  old.serverSend({ type: "ORDER_FILLED", side: "BUY", quantity: 1, symbol: "X", fillPrice: 1 });
  old.serverClose();
  assert.equal(got.filter((m) => m.type === "ORDER_FILLED").length, 0);
  assert.equal(env.sock.getSnapshot().isConnected, true);
});
