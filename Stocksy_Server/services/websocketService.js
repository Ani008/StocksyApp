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
const connectedClients = new Map(); // userId -> Set<ws> (one user can have several tabs/devices)
const INSTRUMENTS = require("../config/instruments");
const { consumeTicket } = require("./wsTicketService");
const sessions = require("./sessionService");
const { isAllowedOrigin } = require("../config/origins");

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

// ── Limits (env-tunable) ────────────────────────────────────────────────────
const intEnv = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const PUSH_INTERVAL_MS = 800;                       // slightly under 1s so app always feels live
const MAX_PAYLOAD_BYTES = intEnv("WS_MAX_PAYLOAD_BYTES", 1024); // clients never need to send anything big
const MAX_CONNS_PER_IP = intEnv("WS_MAX_CONNECTIONS_PER_IP", 10);
const MAX_MSGS_PER_10S = intEnv("WS_MAX_MESSAGES_PER_10S", 20);
const HEARTBEAT_MS = 30_000;
const SESSION_CHECK_MS = 60_000;

const CLOSE_SESSION_ENDED = 4401;

const ALL_KEYS = [
  ...INSTRUMENT_KEYS.map((k) => `stock:${k}`),
  ...INSTRUMENT_KEYS.map((k) => `stock_live:${k}`),
  ...INSTRUMENT_KEYS.map((k) => `stock_ts:${k}`),
];
const N = INSTRUMENT_KEYS.length;

// With `trust proxy 1` the app always sits behind exactly one proxy, which
// appends the real client address as the LAST X-Forwarded-For entry (anything
// before it is client-supplied and can be forged).
function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((v) => v.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : req.socket.remoteAddress || "unknown";
}

function reject(socket, status, text) {
  try {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch { /* ignore */ }
  socket.destroy();
}

function addUserSocket(userId, ws) {
  if (!connectedClients.has(userId)) connectedClients.set(userId, new Set());
  connectedClients.get(userId).add(ws);
}
function removeUserSocket(userId, ws) {
  const set = connectedClients.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) connectedClients.delete(userId);
}

function initWebSocket(server, opts = {}) {
  const pushMs = opts.pushIntervalMs || PUSH_INTERVAL_MS;
  const sessionCheckMs = opts.sessionCheckMs || SESSION_CHECK_MS;

  // noServer + our own 'upgrade' handler so we can refuse a connection
  // (wrong Origin, too many from one IP) before any WebSocket exists.
  const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  console.log('WebSocket server ready');

  const ipCounts = new Map();

  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {});

    // Browsers always send Origin on a WebSocket handshake and JavaScript
    // cannot change it. Anything claiming to be a web page must be OUR web
    // app. (Native apps send no Origin and are allowed.)
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      console.warn(`[WS] Rejected origin ${origin}`);
      return reject(socket, 403, 'Forbidden');
    }

    const ip = clientIp(req);
    if ((ipCounts.get(ip) || 0) >= MAX_CONNS_PER_IP) {
      console.warn(`[WS] Too many connections from ${ip}`);
      return reject(socket, 429, 'Too Many Requests');
    }
    // Reserve the slot NOW (before the async ticket lookup) so a burst of
    // simultaneous handshakes cannot slip past the cap.
    ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);

    let identity = null;
    try {
      const { searchParams } = new URL(req.url, 'http://localhost');
      identity = await consumeTicket(searchParams.get('ticket')); // { uid, sid } | null
    } catch { /* anonymous */ }

    if (socket.destroyed) {
      ipCounts.set(ip, Math.max(0, (ipCounts.get(ip) || 1) - 1));
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._ip = ip;
      ws._identity = identity;
      wss.emit('connection', ws, req);
    });
  });

  // ── ONE shared price feed ───────────────────────────────────────────────
  // Used to be a 800ms timer + 3 Redis reads PER CONNECTION, so every
  // anonymous visitor cost the server 3 reads every 0.8s. Now: one timer, one
  // Redis read, one JSON string, sent to everyone — and nothing at all runs
  // while nobody is connected.
  let feedTimer = null;
  let feedBusy = false;

  async function pushFeed() {
    if (feedBusy) return; // previous tick still reading Redis; skip, don't pile up
    feedBusy = true;
    try {
      const all = await redisClient.mGet(ALL_KEYS); // single round trip
      const values = all.slice(0, N);
      const liveValues = all.slice(N, 2 * N);
      const tsValues = all.slice(2 * N);

      let message;
      if (!values.some((v) => v !== null)) {
        message = JSON.stringify({ error: 'No data in Redis. Run python websocket_client.py first.' });
      } else {
        const stockData = {};
        INSTRUMENT_KEYS.forEach((instrumentKey, i) => {
          const raw = values[i];
          if (!raw) return; // instrument not yet in Redis, skip
          const meta = INSTRUMENTS[instrumentKey];
          stockData[instrumentKey] = {
            ...JSON.parse(raw),
            symbol: meta?.symbol || instrumentKey,
            name: meta?.name || instrumentKey,
            sector: meta?.sector || 'Unknown',
            isLive: liveValues[i] !== null, // key exists = market open
            lastUpdated: tsValues[i] ? parseFloat(tsValues[i]) : null,
          };
        });
        message = JSON.stringify({ type: 'MARKET_DATA', timestamp: Date.now(), data: stockData });
      }

      for (const ws of wss.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
      }
    } catch (err) {
      console.error('WebSocket feed error:', err.message);
    } finally {
      feedBusy = false;
    }
  }

  const startFeed = () => { if (!feedTimer) feedTimer = setInterval(pushFeed, pushMs); };
  const stopFeed = () => { if (feedTimer && wss.clients.size === 0) { clearInterval(feedTimer); feedTimer = null; } };

  wss.on('connection', (ws) => {
    const identity = ws._identity;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    let userId = null;
    if (identity?.uid) {
      userId = String(identity.uid);
      ws._sid = identity.sid;
      ws._uid = userId;
      addUserSocket(userId, ws);
      console.log(`[WS] Registered client for user ${userId}`);
    } else {
      console.log('[WS] Anonymous client — price feed only');
    }

    // Clients never need to send anything; cap how much they can.
    let msgs = 0;
    const msgTimer = setInterval(() => { msgs = 0; }, 10_000);
    ws.on('message', () => {
      if (++msgs > MAX_MSGS_PER_10S) ws.close(1008, 'Too many messages');
    });

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(msgTimer);
      ipCounts.set(ws._ip, Math.max(0, (ipCounts.get(ws._ip) || 1) - 1));
      if (ipCounts.get(ws._ip) === 0) ipCounts.delete(ws._ip);
      if (userId) removeUserSocket(userId, ws);
      stopFeed();
    };
    ws.on('close', cleanup);
    ws.on('error', (err) => { console.error('WebSocket error:', err.message); cleanup(); });

    startFeed();
    pushFeed(); // first frame immediately instead of waiting up to 800ms
  });

  // ── heartbeat: drop connections whose client vanished ────────────────────
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, opts.heartbeatMs || HEARTBEAT_MS);
  heartbeat.unref();

  // ── end live sockets when their session ends ─────────────────────────────
  const endSocket = (ws) => { try { ws.close(CLOSE_SESSION_ENDED, 'session ended'); } catch { /* ignore */ } };

  // instant: this process just revoked a session / all of a user's sessions
  const onRevoked = ({ sid, userId, sids }) => {
    for (const ws of wss.clients) {
      if (!ws._sid) continue;
      if ((sid && ws._sid === sid) || (userId && ws._uid === String(userId)) || (sids && sids.includes(ws._sid))) {
        endSocket(ws);
      }
    }
  };
  sessions.events.on('revoked', onRevoked);

  // backstop: covers revocations done by another server process, and sessions
  // that simply reached their expiry.
  const sessionCheck = setInterval(async () => {
    const authed = [...wss.clients].filter((ws) => ws._sid);
    if (!authed.length) return;
    try {
      const alive = new Set(await sessions.activeIds([...new Set(authed.map((ws) => ws._sid))]));
      for (const ws of authed) if (!alive.has(ws._sid)) endSocket(ws);
    } catch (err) {
      console.error('[WS] session check failed:', err.message);
    }
  }, sessionCheckMs);
  sessionCheck.unref();

  wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(sessionCheck);
    if (feedTimer) clearInterval(feedTimer);
    sessions.events.off('revoked', onRevoked);
  });

  return wss;
}


function notifyClient(userId, payload) {
  const sockets = connectedClients.get(String(userId));
  if (!sockets) return;
  const message = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
  }
}

module.exports = {
  initWebSocket,
  notifyClient,
  clientIp,
};
