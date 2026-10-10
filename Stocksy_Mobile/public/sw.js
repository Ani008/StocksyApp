/* Stocksy service worker
 *
 * Purpose: make the app installable and let the app SHELL (HTML + JS bundle +
 * fonts + icons) open without a network connection.
 *
 * What this deliberately does NOT do:
 *   - It never touches cross-origin requests. Your API (api.stocksy.online),
 *     Google OAuth, and anything else off-origin go straight to the network.
 *   - It never caches or replays non-GET requests (orders, login, etc.).
 *   - It never caches API data. For a trading app a stale price or balance is
 *     worse than an error, so offline data caching is a separate, explicit
 *     decision for later.
 *   - WebSockets are not visible to service workers at all.
 *
 * Bump VERSION to force every client to drop old caches on the next update.
 */

const VERSION = "v1";
const SHELL_CACHE = `stocksy-shell-${VERSION}`;
const RUNTIME_CACHE = `stocksy-runtime-${VERSION}`;

// Fixed cache key for the SPA shell. Every navigation returns the same
// index.html, so one entry is enough (and avoids caching per-URL OAuth
// redirects like /oauth?code=...).
const SHELL_KEY = "/index.html";

const PRECACHE_URLS = [
  "/offline.html",
  "/offline.js",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
];

// If the network is slower than this AND we have a cached shell, open the
// cached shell instead of leaving the user on a blank screen.
const NAVIGATION_TIMEOUT_MS = 3000;

// Max entries kept in the runtime cache (old hashed bundles pile up across
// deploys otherwise).
const RUNTIME_MAX_ENTRIES = 80;

// ─── Install: precache static files + the current shell and its bundles ──────
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE_URLS);

      // Fetch the shell and cache every same-origin script/style it
      // references. Expo emits content-hashed bundle names, so they can't be
      // hard-coded here; reading them out of index.html means the very first
      // offline launch works without having to visit every screen online.
      try {
        const res = await fetch("/", { cache: "reload" });
        if (res.ok && isHtml(res)) {
          const html = await res.clone().text();
          await cache.put(SHELL_KEY, res);
          await Promise.all(
            extractAssetUrls(html).map(async (url) => {
              try {
                const r = await fetch(url, { cache: "reload" });
                if (r.ok) await cache.put(url, r);
              } catch (_) {
                /* best-effort; runtime caching will pick it up later */
              }
            }),
          );
        }
      } catch (_) {
        /* shell fetch is best-effort; install must not fail on it */
      }
    })(),
  );
});

// ─── Activate: drop caches from older versions, take control of open pages ───
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("stocksy-") && !keep.has(n))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// A waiting worker only takes over when the page asks (see pwa-register.js).
// Swapping code under a running trading screen without the user knowing is
// how you get half-old, half-new JS.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ─── Fetch routing ───────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Cross-origin (API, Google OAuth, CDNs): never intercept.
  if (url.origin !== self.location.origin) return;

  // Safari fetches <video> with Range requests, which a plain cache.match
  // can't answer correctly. Let the network handle them.
  if (req.headers.has("range")) return;

  // Same-origin API/auth paths (in case the API is ever proxied under this
  // origin): always network, never cached.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth")) {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(handleNavigation(req));
    return;
  }

  // Content-hashed, immutable build output.
  if (url.pathname.startsWith("/_expo/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Fonts/images bundled by Expo, plus our static PWA files.
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    PRECACHE_URLS.includes(url.pathname) ||
    url.pathname === "/pwa-register.js"
  ) {
    event.respondWith(staleWhileRevalidate(event, req));
    return;
  }

  // Anything else (including dev-server bundles) falls through to the network.
});

// ─── Strategies ──────────────────────────────────────────────────────────────

async function handleNavigation(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cachedShell = await cache.match(SHELL_KEY);

  const network = fetch(req).then((res) => {
    // Keep the shell fresh for the next offline launch. Only store real HTML
    // responses (not a host's 404 page).
    if (res.ok && isHtml(res)) {
      cache.put(SHELL_KEY, res.clone());
    }
    return res;
  });

  try {
    if (!cachedShell) return await network;

    // Network-first, but don't hang on a flaky connection when we have a
    // perfectly good shell to open.
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve(cachedShell), NAVIGATION_TIMEOUT_MS),
    );
    return await Promise.race([network, timeout]);
  } catch (_) {
    // Offline.
    return (
      cachedShell ||
      (await cache.match("/offline.html")) ||
      Response.error()
    );
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;

  const res = await fetch(req);
  await putRuntime(req, res);
  return res;
}

async function staleWhileRevalidate(event, req) {
  const hit = await caches.match(req);

  const refresh = fetch(req)
    .then(async (res) => {
      await putRuntime(req, res);
      return res;
    })
    .catch(() => null);

  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }

  return (await refresh) || Response.error();
}

async function putRuntime(req, res) {
  if (!res || !res.ok || res.type !== "basic") return;

  const cc = res.headers.get("cache-control") || "";
  if (/no-store/i.test(cc)) return;

  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(req, res.clone());

  const keys = await cache.keys();
  if (keys.length > RUNTIME_MAX_ENTRIES) {
    await Promise.all(
      keys.slice(0, keys.length - RUNTIME_MAX_ENTRIES).map((k) => cache.delete(k)),
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isHtml(res) {
  return (res.headers.get("content-type") || "").includes("text/html");
}

// Pull same-origin script/stylesheet URLs out of the shell HTML.
function extractAssetUrls(html) {
  const found = new Set();
  const re = /<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1];
    if (!raw.startsWith("/") || raw.startsWith("//")) continue;
    const path = raw.split("?")[0].split("#")[0];
    if (PRECACHE_URLS.includes(path)) continue;
    if (path === "/") continue;
    if (/\.(?:js|css)$/i.test(path)) found.add(raw);
  }
  return [...found];
}
