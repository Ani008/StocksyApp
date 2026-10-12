
/*
 * Stocksy service worker.
 *
 * Combines offline app-shell caching with build-ID-based update prompts.
 *
 * Safety:
 * - Only same-origin GET requests are handled.
 * - API/auth paths and cross-origin requests are never cached.
 * - Non-GET requests (orders, login, etc.) are never intercepted.
 * - No API data is cached.
 * - New workers wait for user approval before activation.
 *
 * BUILD_ID is replaced at build time by scripts/stamp-sw.mjs.
 */

const BUILD_ID = "__BUILD_ID__";
const VERSION =
  BUILD_ID && BUILD_ID !== "__BUILD_ID__" ? BUILD_ID : "dev";

const SHELL_CACHE = `stocksy-shell-${VERSION}`;
const RUNTIME_CACHE = `stocksy-runtime-${VERSION}`;
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

const NAVIGATION_TIMEOUT_MS = 3000;
const RUNTIME_MAX_ENTRIES = 80;

// Install: cache the offline files, app shell and referenced JS/CSS.
// Do not call skipWaiting() automatically.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);

      // Cache available static files without failing installation
      // if an optional file is missing.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: "reload" });
            if (response.ok) {
              await cache.put(url, response);
            }
          } catch (_) {
            // Best effort.
          }
        })
      );

      try {
        const response = await fetch("/", { cache: "reload" });

        if (response.ok && isHtml(response)) {
          const html = await response.clone().text();

          await cache.put(SHELL_KEY, response);

          await Promise.all(
            extractAssetUrls(html).map(async (url) => {
              try {
                const assetResponse = await fetch(url, {
                  cache: "reload",
                });

                if (assetResponse.ok) {
                  await cache.put(url, assetResponse);
                }
              } catch (_) {
                // Best effort; runtime caching may pick it up later.
              }
            })
          );
        }
      } catch (_) {
        // The shell fetch is best effort.
      }
    })()
  );
});

// Activate: remove older Stocksy caches and control open pages.
// This runs when the new worker is allowed to activate.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
      const names = await caches.keys();

      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith("stocksy-") && !keep.has(name)
          )
          .map((name) => caches.delete(name))
      );

      await self.clients.claim();
    })()
  );
});

// Update prompt integration.
// The page can request BUILD_ID and explicitly approve an update.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (
    data.type === "GET_BUILD_ID" &&
    event.ports &&
    event.ports[0]
  ) {
    event.ports[0].postMessage(BUILD_ID);
  }
});

// ── Web push ────────────────────────────────────────────────────────────────
// Payload (JSON, from the server's webPushService): { title, body, url, tag }.
// Browsers (iOS especially) revoke a site's push permission if a push arrives
// and no notification is shown, so a notification is ALWAYS shown, even when
// the payload is missing or malformed.
function safePushUrl(raw) {
  // Only same-origin paths. Anything else falls back to the app root so a
  // crafted payload can never send the user to another site.
  if (typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return "/";
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = {};
  }

  const title =
    typeof data.title === "string" && data.title ? data.title : "Stocksy";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/icons/icon-192.png",
    data: { url: safePushUrl(data.url) },
  };

  if (typeof data.tag === "string" && data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safePushUrl(
    event.notification.data && event.notification.data.url
  );

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
          client.postMessage({ type: "NOTIFICATION_CLICK", url });
          return;
        } catch (_) {
          // Could not focus this one; try the next, then open a new window.
        }
      }

      await self.clients.openWindow(url);
    })()
  );
});

// The browser rotated the push subscription. Re-subscribe with the same key
// and tell open pages; the app re-registers the new endpoint with the server
// (the worker has no access to the login token).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const key =
          event.oldSubscription &&
          event.oldSubscription.options &&
          event.oldSubscription.options.applicationServerKey;
        if (key) {
          await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          });
        }
      } catch (_) {
        // The app will offer to turn notifications on again.
      }
      const windows = await self.clients.matchAll({ type: "window" });
      windows.forEach((c) => c.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED" }));
    })()
  );
});

// Fetch routing.
self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never intercept cross-origin requests.
  if (url.origin !== self.location.origin) return;

  // Let the network handle media Range requests.
  if (request.headers.has("range")) return;

  // Never cache same-origin API or authentication routes.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  // Content-hashed Expo bundles.
  if (url.pathname.startsWith("/_expo/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Static assets and PWA support files.
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    PRECACHE_URLS.includes(url.pathname) ||
    url.pathname === "/pwa-register.js"
  ) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});

// Navigation: try network, but use the cached shell if offline
// or if the network takes too long.
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cachedShell = await cache.match(SHELL_KEY);

  const network = fetch(request).then((response) => {
    if (response.ok && isHtml(response)) {
      cache.put(SHELL_KEY, response.clone());
    }

    return response;
  });

  try {
    if (!cachedShell) return await network;

    const timeout = new Promise((resolve) => {
      setTimeout(
        () => resolve(cachedShell),
        NAVIGATION_TIMEOUT_MS
      );
    });

    return await Promise.race([network, timeout]);
  } catch (_) {
    return (
      cachedShell ||
      (await cache.match("/offline.html")) ||
      Response.error()
    );
  }
}

// Cache-first strategy for hashed bundles.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  await putRuntime(request, response);

  return response;
}

// Stale-while-revalidate strategy for static assets.
async function staleWhileRevalidate(event, request) {
  const cached = await caches.match(request);

  const refresh = fetch(request)
    .then(async (response) => {
      await putRuntime(request, response);
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }

  return (await refresh) || Response.error();
}

// Store successful same-origin responses with a bounded cache size.
async function putRuntime(request, response) {
  if (
    !response ||
    !response.ok ||
    response.type !== "basic"
  ) {
    return;
  }

  const cacheControl =
    response.headers.get("cache-control") || "";

  if (/no-store/i.test(cacheControl)) return;

  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(request, response.clone());

  const keys = await cache.keys();

  if (keys.length > RUNTIME_MAX_ENTRIES) {
    await Promise.all(
      keys
        .slice(0, keys.length - RUNTIME_MAX_ENTRIES)
        .map((key) => cache.delete(key))
    );
  }
}

function isHtml(response) {
  return (
    response.headers.get("content-type") || ""
  ).includes("text/html");
}

// Extract same-origin JavaScript and CSS assets from index.html.
function extractAssetUrls(html) {
  const found = new Set();

  const regex =
    /<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["'][^>]*>/gi;

  let match;

  while ((match = regex.exec(html))) {
    const raw = match[1];

    if (!raw.startsWith("/") || raw.startsWith("//")) {
      continue;
    }

    const path = raw.split("?")[0].split("#")[0];

    if (PRECACHE_URLS.includes(path) || path === "/") {
      continue;
    }

    if (/\.(?:js|css)$/i.test(path)) {
      found.add(raw);
    }
  }

  return [...found];
}
