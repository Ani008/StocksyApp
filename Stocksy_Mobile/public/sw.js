/* Stocksy service worker.
 *
 * Deliberately minimal: it does NOT cache or intercept any request (offline
 * shell is a separate piece of work). Its job right now is to drive the
 * "new version available" flow:
 *
 *  - The browser re-downloads this file on every check and treats ANY byte
 *    difference as a new version. BUILD_ID below is stamped with a hash of
 *    the exported bundle by scripts/stamp-sw.mjs (npm run build:web), so a
 *    new deploy => new sw.js => the app sees a waiting worker and shows
 *    "New version available".
 *  - The new worker must NOT call skipWaiting() on its own. It waits until
 *    the user taps Refresh (the page sends SKIP_WAITING), so a trading
 *    session is never swapped out from under someone mid-order.
 */

// Replaced at build time. Never edit by hand.
const BUILD_ID = "__BUILD_ID__";

self.addEventListener("install", () => {
  // Intentionally no self.skipWaiting() — wait for the user.
});

self.addEventListener("activate", (event) => {
  // Take control of already-open pages so a first install is controlled
  // immediately (and so a user-approved update takes effect).
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (data.type === "GET_BUILD_ID" && event.ports && event.ports[0]) {
    event.ports[0].postMessage(BUILD_ID);
  }
});
