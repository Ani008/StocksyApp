// services/marketSocketCore.js
//
// One shared, lifecycle-aware WebSocket connection for the whole app.
//
// WHY THIS EXISTS (instead of every screen opening its own socket):
//   - The server remembers ONE socket per user (connectedClients Map). With a
//     socket per screen, whichever connected last "owned" the user, and when
//     that screen unmounted its close() DELETED the registration — so an
//     ORDER_FILLED that landed after leaving the order screen was silently
//     dropped. One socket per app session fixes that.
//   - Each socket costs the server 3 Redis mGets every 800 ms; 5 screens
//     meant 5x the load for one user.
//   - Phone/PWA lifecycle (background, wake, flaky network) needs ONE place
//     that decides when to reconnect.
//
// This file is plain JS with injected dependencies (WebSocket class, app
// state, network, token getter, toast) so it can be unit-tested in Node.
// services/marketSocket.js wires in the React Native / web implementations.
//
// Behaviour summary:
//   - Connects while at least one screen is attached; closes after a short
//     idle grace period when none are.
//   - Reconnects with exponential backoff + jitter (1s, 2s, 4s ... 30s).
//   - Reconnects immediately when the app returns to the foreground or the
//     network comes back; does NOT burn retries while offline/backgrounded.
//   - Stale-socket watchdog: the server pushes every ~800 ms even when the
//     market is closed, so no message for `staleMs` means the socket is dead
//     (typical after a phone sleeps / network switch) -> force reconnect.
//   - Emits { type: "RESYNC" } to attached callbacks after any gap (reconnect,
//     or resuming after being hidden for a while), because order-fill pushes
//     sent while disconnected are gone for good — screens must refetch.
//   - Reconnects if the logged-in user changes, so notifications never go to
//     the previous user's identity.

export const DEFAULTS = {
  backoffBaseMs: 1000,
  backoffMaxMs: 30000,
  jitter: 0.2, // +/- 20%
  staleMs: 12000,
  watchdogMs: 4000,
  resumeCheckMs: 4000,
  idleGraceMs: 10000,
  resyncAfterHiddenMs: 10000,
  resyncMinGapMs: 3000,
};

const CONNECTING = 0;
const OPEN = 1;

export function createMarketSocket(deps) {
  const {
    url: baseUrl,
    getToken,
    WebSocketImpl,
    appState,
    network,
    onToast = () => {},
    log = () => {},
    random = Math.random,
  } = deps;
  const cfg = { ...DEFAULTS, ...(deps.config || {}) };

  let ws = null;
  let started = false;
  let generation = 0; // bumps per connect() so stale async continuations bail out
  let attempt = 0;
  let connectedToken; // undefined = never connected; null = anonymous
  let hasOpenedBefore = false;
  let lastMessageAt = 0;
  let lastResyncAt = -Infinity;
  let hiddenAt = null;
  // After a resume the watchdog stays quiet until this time: the last message
  // is naturally old right after waking, so judging then would drop a healthy
  // socket before its next push (~800 ms) has had a chance to arrive. The
  // resume check (below) is the sole judge for that window.
  let quietUntil = 0;

  let retryTimer = null;
  let watchdogTimer = null;
  let resumeTimer = null;
  let idleTimer = null;
  let unsubApp = null;
  let unsubNet = null;

  const attached = new Set();
  const listeners = new Set();

  let snapshot = {
    prices: {},
    isConnected: false,
    isOnline: network.isOnline(),
    active: false,
    error: null,
  };

  // ── store plumbing (useSyncExternalStore-compatible) ───────────────────────
  function setSnapshot(patch) {
    let changed = false;
    for (const k of Object.keys(patch)) {
      if (snapshot[k] !== patch[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        /* a bad listener must not break the others */
      }
    });
  }
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getSnapshot = () => snapshot;

  function emit(event) {
    attached.forEach((entry) => {
      try {
        entry.cb(event);
      } catch (e) {
        log("callback threw", e && e.message);
      }
    });
  }

  function emitResync(reason) {
    const t = Date.now();
    if (t - lastResyncAt < cfg.resyncMinGapMs) return;
    lastResyncAt = t;
    log("RESYNC:", reason);
    emit({ type: "RESYNC", reason });
  }

  const shouldRun = () => started && attached.size > 0;

  // ── timers ─────────────────────────────────────────────────────────────────
  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }
  function clearResume() {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  }
  function stopWatchdog() {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  }
  function startWatchdog() {
    stopWatchdog();
    watchdogTimer = setInterval(() => {
      if (!ws || ws.readyState !== OPEN) return;
      if (appState.current() !== "active") return; // timers are throttled when hidden
      if (Date.now() < quietUntil) return; // resume check is judging right now
      if (Date.now() - lastMessageAt > cfg.staleMs) {
        forceReconnect("stale (no data)");
      }
    }, cfg.watchdogMs);
  }

  // ── socket lifecycle ───────────────────────────────────────────────────────
  function closeSocket() {
    const s = ws;
    ws = null;
    stopWatchdog();
    clearResume();
    if (s) {
      // Detach first so this deliberate close doesn't schedule a reconnect.
      s.onopen = s.onmessage = s.onerror = s.onclose = null;
      try {
        s.close();
      } catch (e) {
        /* already closed */
      }
    }
    setSnapshot({ isConnected: false });
  }

  function forceReconnect(reason) {
    log("force reconnect:", reason);
    closeSocket();
    clearRetry();
    attempt = 0;
    connect(reason);
  }

  function scheduleRetry() {
    if (retryTimer || !shouldRun()) return;
    // Nothing to gain from retrying while backgrounded; the foreground
    // handler reconnects immediately instead.
    if (appState.current() !== "active") return;

    let delay;
    if (!network.isOnline()) {
      // The `online` event reconnects instantly. This slow probe is only
      // insurance against a browser that never fires it (navigator.onLine
      // can be wrong), so it must not hammer a genuinely offline device.
      delay = cfg.backoffMaxMs;
    } else {
      const exp = Math.min(cfg.backoffMaxMs, cfg.backoffBaseMs * 2 ** attempt);
      delay = Math.round(exp * (1 - cfg.jitter + random() * cfg.jitter * 2));
      attempt += 1;
    }
    log(`retry in ${delay}ms (attempt ${attempt})`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect("retry");
    }, delay);
  }

  function handleClosed() {
    ws = null;
    stopWatchdog();
    clearResume();
    setSnapshot({ isConnected: false });
    scheduleRetry();
  }

  async function connect(reason) {
    if (!shouldRun()) return;
    clearRetry();
    if (ws && (ws.readyState === OPEN || ws.readyState === CONNECTING)) return;
    if (!baseUrl) {
      setSnapshot({ error: "Live data URL is not configured" });
      return;
    }

    const myGen = ++generation;
    let token = null;
    try {
      token = (await getToken()) || null;
    } catch (e) {
      /* storage unavailable: connect anonymously (price feed is public) */
    }
    // Superseded by a newer connect()/forceReconnect, or stopped meanwhile.
    if (myGen !== generation || !shouldRun()) return;
    if (ws && (ws.readyState === OPEN || ws.readyState === CONNECTING)) return;

    connectedToken = token;
    const target = token
      ? `${baseUrl}?token=${encodeURIComponent(token)}`
      : baseUrl;

    let sock;
    try {
      sock = new WebSocketImpl(target);
    } catch (e) {
      setSnapshot({ error: "Failed to connect" });
      scheduleRetry();
      return;
    }
    ws = sock;
    log("connecting:", reason);

    sock.onopen = () => {
      if (ws !== sock) return;
      attempt = 0;
      lastMessageAt = Date.now();
      const isReopen = hasOpenedBefore;
      hasOpenedBefore = true;
      setSnapshot({ isConnected: true, error: null });
      startWatchdog();
      // Anything pushed while we were disconnected is lost: tell screens to refetch.
      if (isReopen) emitResync("reconnected");
    };

    sock.onmessage = (event) => {
      if (ws !== sock) return;
      lastMessageAt = Date.now();
      handleMessage(event.data);
    };

    sock.onerror = () => {
      if (ws !== sock) return;
      setSnapshot({ error: "Connection error", isConnected: false });
    };

    sock.onclose = () => {
      if (ws !== sock) return;
      log("socket closed");
      handleClosed();
    };
  }

  function handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      log("unparseable message");
      return;
    }

    if (msg.error) {
      setSnapshot({ error: msg.error });
      return;
    }

    if (msg.type === "MARKET_DATA" && msg.data) {
      // New object every message so React sees the change.
      const updated = { ...snapshot.prices };
      for (const [instrumentKey, feedData] of Object.entries(msg.data)) {
        const ltpc = feedData.ltpc || {};
        updated[instrumentKey] = {
          ltp: parseFloat(ltpc.ltp) || 0,
          cp: parseFloat(ltpc.cp) || 0,
          ltt: ltpc.ltt || null,
          symbol: feedData.symbol || instrumentKey,
          name: feedData.name || instrumentKey,
          sector: feedData.sector || "Equity",
          isLive: feedData.isLive ?? false,
          lastUpdated: feedData.lastUpdated ?? null,
          _ts: msg.timestamp, // so even same-price ticks trigger a re-render
        };
      }
      setSnapshot({ prices: updated, error: null });
      return;
    }

    // ── Per-user pushes: toast ONCE here, then let every attached screen refetch.
    if (msg.type === "ORDER_FILLED") {
      onToast(
        `${msg.side} ${msg.quantity} ${msg.symbol} filled @ ₹${msg.fillPrice?.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
        "success",
      );
      emit(msg);
      return;
    }
    if (msg.type === "ORDER_REJECTED") {
      onToast(`Order rejected — ${msg.reason || "unknown reason"}`, "error");
      emit(msg);
      return;
    }
    if (msg.type === "RMS_SQUARE_OFF") {
      onToast(
        `${msg.symbol} auto-squared off — loss reached ${Math.round((msg.lossRatio || 0) * 100)}% of margin`,
        "warning",
      );
      emit(msg);
    }
  }

  // ── lifecycle events ───────────────────────────────────────────────────────
  function onAppState(next) {
    if (next !== "active") {
      hiddenAt = Date.now();
      clearRetry();
      clearResume();
      return;
    }

    const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    if (!shouldRun()) return;
    quietUntil = Date.now() + cfg.resumeCheckMs;

    ensureIdentity();

    if (!ws || ws.readyState > OPEN) {
      // Closed while we were away: reconnect now, no backoff.
      attempt = 0;
      clearRetry();
      connect("foreground");
      return;
    }

    if (ws.readyState === OPEN) {
      // "Open" can be a lie after the device slept. The server sends every
      // ~800 ms, so if nothing arrives soon after resume the socket is dead.
      const since = Date.now();
      clearResume();
      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        if (ws && lastMessageAt < since) forceReconnect("stale after resume");
      }, cfg.resumeCheckMs);

      // We may have been frozen while pushes happened.
      if (hiddenFor > cfg.resyncAfterHiddenMs) emitResync("resumed");
    }
  }

  function onNetwork(online) {
    setSnapshot({ isOnline: online });
    if (!shouldRun()) return;

    if (!online) {
      // Browsers can take minutes to notice a dead socket; reflect reality now.
      clearRetry();
      closeSocket();
      // Arms the slow (30 s) probe, in case this browser never fires `online`.
      scheduleRetry();
      return;
    }
    if (!ws || ws.readyState > OPEN) {
      attempt = 0;
      clearRetry();
      connect("online");
    }
  }

  async function ensureIdentity() {
    let token = null;
    try {
      token = (await getToken()) || null;
    } catch (e) {
      /* ignore */
    }
    if (ws && connectedToken !== undefined && token !== connectedToken) {
      forceReconnect("identity changed");
    }
  }

  // ── public API ─────────────────────────────────────────────────────────────
  function start() {
    if (started) return;
    started = true;
    unsubApp = appState.subscribe(onAppState);
    unsubNet = network.subscribe(onNetwork);
    setSnapshot({ isOnline: network.isOnline() });
  }

  function stop() {
    started = false;
    if (unsubApp) unsubApp();
    if (unsubNet) unsubNet();
    unsubApp = unsubNet = null;
    clearRetry();
    closeSocket();
    hasOpenedBefore = false;
    connectedToken = undefined;
    attempt = 0;
    hiddenAt = null;
  }

  /** Register a screen. cb receives ORDER_* / RMS_SQUARE_OFF / RESYNC events. */
  function attach(cb) {
    const entry = { cb: cb || (() => {}) };
    attached.add(entry);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    start();
    setSnapshot({ active: true });

    if (ws && ws.readyState <= OPEN) {
      ensureIdentity(); // user may have changed while nobody was attached
    } else {
      connect("attach");
    }

    return function detach() {
      attached.delete(entry);
      if (attached.size === 0) {
        setSnapshot({ active: false });
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          idleTimer = null;
          if (attached.size === 0) stop();
        }, cfg.idleGraceMs);
      }
    };
  }

  /** Call when the logged-in user changes (login, logout, delete account). */
  function resetIdentity() {
    if (ws && shouldRun()) forceReconnect("identity reset");
    else if (ws) closeSocket();
  }

  return {
    attach,
    subscribe,
    getSnapshot,
    resetIdentity,
    reconnect: () => shouldRun() && forceReconnect("manual"),
  };
}
