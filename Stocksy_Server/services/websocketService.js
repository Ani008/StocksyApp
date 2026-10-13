// services/websocketService.js
//
// ══════════════════════════════════════════════════════════════════════════════
// ROOT CAUSE OF "prices not updating" BUG — READ THIS FIRST
// ══════════════════════════════════════════════════════════════════════════════
//
// PROBLEM 1 — redisClient.keys('stock:*') is O(N) and BLOCKS Redis.
//   On every 1-second interval, calling KEYS scans ALL keys in the DB.
//   This is slow and can lag behind real data. Use a hardcoded key list instead.
//
// PROBLEM 2 — Individual redisClient.get() calls inside a loop are sequential.
//   47 instruments × 1 get() each = 47 round-trips to Redis Cloud before
//   you can send even one message. With cloud Redis latency (~20-50ms each),
//   that's 1-2 seconds just reading. By the time you send, data is already stale.
//   FIX: Use mGet() — one round-trip for all 47 keys simultaneously.
//
// PROBLEM 3 — If any single get() throws, the entire interval silently dies
//   because the error isn't caught at the interval level.
//
// PROBLEM 4 — The 1000ms push interval is measured from the START of the
//   previous interval, not from when it finishes. If Redis reads take 800ms,
//   you're effectively pushing every 1800ms, not 1000ms.
//
// ══════════════════════════════════════════════════════════════════════════════

const WebSocket = require("ws");
const { URL } = require("url");
const { isOriginAllowed } = require("../config/cors");
const sessions = require("./sessionService");
const connectedClients = new Map(); // userId -> that user's authenticated socket
const INSTRUMENTS = require("../config/instruments");

// ── Flexible import — handles all 3 common export shapes ────────────────────
// Shape A: module.exports = client          → require() returns client directly
// Shape B: module.exports = { redisClient } → named export
// Shape C: module.exports = { client }      → named export
const _redisImport = require("./redisService");
const redisClient =
  _redisImport.redisClient || // shape B
  _redisImport.client || // shape C
  _redisImport; // shape A (default export)

// All instrument keys — must match exactly what Python saves as stock:{key}
const INSTRUMENT_KEYS = [
  "NSE_INDEX|Nifty 50",
  "NSE_INDEX|Nifty Bank",
  "BSE_INDEX|SENSEX",
  "NSE_INDEX|Nifty Fin Service",
  "NSE_EQ|INE040A01034",
  "NSE_EQ|INE090A01021",
  "NSE_EQ|INE062A01020",
  "NSE_EQ|INE238A01034",
  "NSE_EQ|INE296A01032",
  "NSE_EQ|INE237A01036",
  "NSE_EQ|INE795G01014",
  "NSE_EQ|INE918I01026",
  "NSE_EQ|INE467B01029",
  "NSE_EQ|INE009A01021",
  "NSE_EQ|INE075A01022",
  "NSE_EQ|INE860A01027",
  "NSE_EQ|INE669C01036",
  "NSE_EQ|INE214T01019",
  "NSE_EQ|INE002A01018",
  "NSE_EQ|INE213A01029",
  "NSE_EQ|INE029A01011",
  "NSE_EQ|INE752E01010",
  "NSE_EQ|INE733E01010",
  "NSE_EQ|INE585B01010",
  "NSE_EQ|INE1TAE01010",
  "NSE_EQ|INE917I01010",
  "NSE_EQ|INE066A01021",
  "NSE_EQ|INE158A01026",
  "NSE_EQ|INE030A01027",
  "NSE_EQ|INE154A01025",
  "NSE_EQ|INE239A01024",
  "NSE_EQ|INE016A01026",
  "NSE_EQ|INE216A01030",
  "NSE_EQ|INE044A01036",
  "NSE_EQ|INE089A01031",
  "NSE_EQ|INE059A01026",
  "NSE_EQ|INE361B01024",
  "NSE_EQ|INE081A01020",
  "NSE_EQ|INE038A01020",
  "NSE_EQ|INE019A01038",
  "NSE_EQ|INE522F01014",
  "NSE_EQ|INE397D01024",
  "NSE_EQ|INE742F01042",
  "NSE_EQ|INE364U01010",
  "NSE_EQ|INE481G01011",
  "NSE_EQ|INE018A01030",
  "NSE_EQ|INE047A01021",
  "NSE_EQ|INE423A01024",
  "NSE_EQ|INE1NPP01017",

  "NSE_EQ|INE205A01025",
  "NSE_EQ|INE263A01024",
  "NSE_EQ|INE053F01010",
  "NSE_EQ|INE040H01021",
];

// Pre-build the Redis keys array once — no string building on every tick
const REDIS_KEYS = INSTRUMENT_KEYS.map((k) => `stock:${k}`);

// Push interval in ms
const PUSH_INTERVAL_MS = 800; // slightly under 1s so app always feels live

// ══════════════════════════════════════════════════════════════════════════════
// SECURITY MODEL (security review item 11)
// ══════════════════════════════════════════════════════════════════════════════
//
//  * The live-price feed stays public (no login needed to watch prices), but
//    one shared loop reads Redis ONCE per tick for ALL sockets, and does
//    nothing at all when nobody is connected — so connections no longer
//    multiply Redis load (it used to be 3 reads / 0.8 s PER connection).
//  * Browsers must connect from an allowed origin (config/cors.js).
//  * Each IP may hold only WS_MAX_CONNECTIONS_PER_IP sockets (default 20).
//  * Messages are capped at 4 KB and rate-limited per socket.
//  * The JWT is NOT put in the URL (it ends up in proxy/access logs). The
//    client sends { type: "AUTH", token } as its first message.
//  * Authenticated sockets are bound to their login session: logout, password
//    reset and account deletion close them at once, and when the access token
//    is about to expire the server asks for a fresh one ({ type: "REAUTH" })
//    and closes the socket (code 4401) if none arrives in time.
//
//  WS_ALLOW_QUERY_TOKEN (default true) still accepts the OLD ?token= form so
//  app builds already installed keep working. Set it to false once those
//  builds are gone.

const MAX_PAYLOAD_BYTES = 4 * 1024;
const MAX_CONNECTIONS_PER_IP = Math.max(
  1,
  parseInt(process.env.WS_MAX_CONNECTIONS_PER_IP, 10) || 20,
);
const ALLOW_QUERY_TOKEN = process.env.WS_ALLOW_QUERY_TOKEN !== "false";
const REAUTH_LEAD_MS = 60 * 1000; // ask for a new token this long before expiry
const SWEEP_MS = parseInt(process.env.WS_SWEEP_MS, 10) || 10 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const MAX_MESSAGES_PER_SWEEP = 20;
const MAX_BUFFERED_BYTES = 1024 * 1024; // skip slow consumers instead of queueing

const CLOSE_AUTH = 4401; // token expired / session revoked / bad token
const CLOSE_POLICY = 1008;

// Per-socket state
const meta = new WeakMap(); // ws -> { ip, userId, sid, expMs, reauthAsked, msgs, alive }
const sockets = new Set(); // every open socket
const ipCounts = new Map(); // ip -> open sockets

function clientIp(req) {
  // Behind the reverse proxy (server.js: trust proxy 1) the proxy appends the
  // real client address as the LAST X-Forwarded-For entry. Without a proxy
  // that header is attacker-controlled, so it is only trusted in production.
  if (process.env.NODE_ENV === "production") {
    const xff = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return req.socket.remoteAddress || "unknown";
}

function rejectUpgrade(socket, status, text) {
  try {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch {
    /* socket already gone */
  }
  socket.destroy();
}

function unregister(ws) {
  const m = meta.get(ws);
  sockets.delete(ws);
  if (m?.userId && connectedClients.get(m.userId) === ws) {
    connectedClients.delete(m.userId);
  }
}

/**
 * Bind this socket to a user via a JWT. Returns true on success. On any
 * failure the socket is closed (4401) so the client fetches a fresh token and
 * reconnects. A socket can only ever be re-authenticated as the SAME user.
 */
async function authenticate(ws, token) {
  const m = meta.get(ws);
  if (!m) return false;
  try {
    if (typeof token !== "string" || token.length > 2048) throw new Error("bad token");
    const decoded = sessions.verifyAccessToken(token);
    const user = await sessions.findActiveUser(decoded);
    if (!user) throw new Error("session not active");
    if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) return false;

    const userId = String(decoded.id);
    if (m.userId && m.userId !== userId) throw new Error("identity change");

    m.userId = userId;
    m.sid = decoded.sid;
    m.expMs = decoded.exp * 1000;
    m.reauthAsked = false;
    connectedClients.set(userId, ws);
    return true;
  } catch (err) {
    console.log("[WS] auth rejected:", err.message);
    try {
      ws.close(CLOSE_AUTH, "auth failed");
    } catch {
      /* already closed */
    }
    return false;
  }
}

function handleMessage(ws, raw, isBinary) {
  const m = meta.get(ws);
  if (!m) return;
  if (++m.msgs > MAX_MESSAGES_PER_SWEEP) {
    ws.close(CLOSE_POLICY, "too many messages");
    return;
  }
  if (isBinary) return;

  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (msg && msg.type === "AUTH") authenticate(ws, msg.token);
  // anything else is ignored: this socket is server -> client only
}

// ── one shared price loop ────────────────────────────────────────────────────
async function readMarketPayload(redisClient) {
  const live = INSTRUMENT_KEYS.map((k) => `stock_live:${k}`);
  const ts = INSTRUMENT_KEYS.map((k) => `stock_ts:${k}`);
  const n = INSTRUMENT_KEYS.length;

  // ONE round trip for prices, live flags and timestamps together.
  const all = await redisClient.mGet([...REDIS_KEYS, ...live, ...ts]);
  const values = all.slice(0, n);
  const liveValues = all.slice(n, 2 * n);
  const tsValues = all.slice(2 * n);

  if (!values.some((v) => v !== null)) {
    return JSON.stringify({
      error: "No data in Redis. Run python websocket_client.py first.",
    });
  }

  const stockData = {};
  INSTRUMENT_KEYS.forEach((instrumentKey, i) => {
    const raw = values[i];
    if (!raw) return; // instrument not yet in Redis, skip

    const metaInfo = INSTRUMENTS[instrumentKey];
    const feedData = JSON.parse(raw);
    stockData[instrumentKey] = {
      ...feedData,
      symbol: metaInfo?.symbol || instrumentKey,
      name: metaInfo?.name || instrumentKey,
      sector: metaInfo?.sector || "Unknown",
      isLive: liveValues[i] !== null, // key exists = market open
      lastUpdated: tsValues[i] ? parseFloat(tsValues[i]) : null,
    };
  });

  return JSON.stringify({
    type: "MARKET_DATA",
    timestamp: Date.now(),
    data: stockData,
  });
}

function initWebSocket(server) {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  console.log("WebSocket server ready");

  // ── upgrade gate: origin + per-IP cap, before any socket exists ────────────
  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {});

    if (!isOriginAllowed(req.headers.origin)) {
      return rejectUpgrade(socket, 403, "Forbidden");
    }

    const ip = clientIp(req);
    const open = ipCounts.get(ip) || 0;
    if (open >= MAX_CONNECTIONS_PER_IP) {
      return rejectUpgrade(socket, 429, "Too Many Connections");
    }

    // Reserve the slot now; the underlying TCP socket closing always frees it.
    ipCounts.set(ip, open + 1);
    socket.once("close", () => {
      const left = (ipCounts.get(ip) || 1) - 1;
      if (left <= 0) ipCounts.delete(ip);
      else ipCounts.set(ip, left);
    });

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    console.log("WebSocket client connected");
    meta.set(ws, {
      userId: null,
      sid: null,
      expMs: 0,
      reauthAsked: false,
      msgs: 0,
      alive: true,
    });
    sockets.add(ws);

    ws.on("pong", () => {
      const m = meta.get(ws);
      if (m) m.alive = true;
    });
    ws.on("message", (data, isBinary) => handleMessage(ws, data, isBinary));
    ws.on("close", () => unregister(ws));
    ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
      unregister(ws);
    });

    // Legacy builds put the JWT in the URL. Never logged here.
    if (ALLOW_QUERY_TOKEN) {
      try {
        const token = new URL(req.url, "http://localhost").searchParams.get("token");
        if (token) authenticate(ws, token);
      } catch {
        /* unparseable URL: serve the public feed only */
      }
    }
  });

  // ── shared price broadcast ─────────────────────────────────────────────────
  let stopped = false;
  let priceTimer = null;

  const tick = async () => {
    try {
      if (sockets.size > 0) {
        const payload = await readMarketPayload(redisClient);
        for (const ws of sockets) {
          if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED_BYTES) {
            ws.send(payload);
          }
        }
      }
    } catch (err) {
      console.error("WebSocket broadcast error:", err);
    } finally {
      // Scheduled AFTER the work finishes, so a slow Redis can never stack up
      // overlapping reads.
      if (!stopped) priceTimer = setTimeout(tick, PUSH_INTERVAL_MS);
    }
  };
  priceTimer = setTimeout(tick, PUSH_INTERVAL_MS);

  // ── token-expiry sweep + per-socket message budget ─────────────────────────
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const ws of sockets) {
      const m = meta.get(ws);
      if (!m) continue;
      m.msgs = 0;
      if (!m.userId) continue;
      if (now >= m.expMs) {
        ws.close(CLOSE_AUTH, "token expired");
      } else if (!m.reauthAsked && now >= m.expMs - REAUTH_LEAD_MS) {
        m.reauthAsked = true;
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "REAUTH" }));
      }
    }
  }, SWEEP_MS);

  // ── heartbeat: drop sockets whose peer vanished ────────────────────────────
  const heartbeatTimer = setInterval(() => {
    for (const ws of sockets) {
      const m = meta.get(ws);
      if (!m) continue;
      if (!m.alive) {
        ws.terminate();
        continue;
      }
      m.alive = false;
      try {
        ws.ping();
      } catch {
        /* closing */
      }
    }
  }, HEARTBEAT_MS);

  // ── revocation: logout / password reset / account deletion ─────────────────
  const onSessionRevoked = ({ sessionId }) => {
    for (const ws of sockets) {
      if (meta.get(ws)?.sid === sessionId) ws.close(CLOSE_AUTH, "session revoked");
    }
  };
  const onUserRevoked = ({ userId }) => {
    for (const ws of sockets) {
      if (meta.get(ws)?.userId === String(userId)) ws.close(CLOSE_AUTH, "session revoked");
    }
  };
  sessions.events.on("session-revoked", onSessionRevoked);
  sessions.events.on("user-sessions-revoked", onUserRevoked);

  wss.on("close", () => {
    stopped = true;
    clearTimeout(priceTimer);
    clearInterval(sweepTimer);
    clearInterval(heartbeatTimer);
    sessions.events.off("session-revoked", onSessionRevoked);
    sessions.events.off("user-sessions-revoked", onUserRevoked);
  });

  return wss;
}

function notifyClient(userId, payload) {
  const client = connectedClients.get(String(userId));

  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload));
  }
}

module.exports = {
  initWebSocket,
  notifyClient,
};
