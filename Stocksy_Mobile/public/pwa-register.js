/* Registers the service worker and exposes PWA hooks to the React app.
 *
 * Kept as an external file (not inline in index.html) so a strict
 * Content-Security-Policy can be applied later.
 *
 * Hooks for the app (used by the update / install UI in a later step):
 *
 *   window.addEventListener("stocksy:sw-update", (e) => { ...; e.detail.apply(); })
 *     Fired when a new service worker is installed and waiting. Calling
 *     detail.apply() activates it and reloads the page once.
 *     Also stored on window.__stocksyPendingUpdate for components that mount
 *     after the event fired.
 *
 *   window.addEventListener("stocksy:install-available", ...)
 *     Fired when the browser says the app is installable (Chrome/Edge/Android).
 *     The deferred prompt is window.__stocksyInstallPrompt; call .prompt() on
 *     it from a user gesture. iOS Safari never fires this event.
 */
(function () {
  // ── Capture the install prompt early ───────────────────────────────────────
  // beforeinstallprompt can fire before React has mounted, so it has to be
  // caught here and handed over later.
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    window.__stocksyInstallPrompt = e;
    window.dispatchEvent(new CustomEvent("stocksy:install-available"));
  });
  window.addEventListener("appinstalled", function () {
    window.__stocksyInstallPrompt = null;
  });

  // ── Service worker ─────────────────────────────────────────────────────────
  if (!("serviceWorker" in navigator)) return;

  var isLocal =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";
  // Service workers require HTTPS (localhost is exempt for development).
  if (location.protocol !== "https:" && !isLocal) return;

  var applying = false;

  function announce(worker) {
    var apply = function () {
      applying = true;
      worker.postMessage({ type: "SKIP_WAITING" });
    };
    window.__stocksyPendingUpdate = apply;
    window.dispatchEvent(
      new CustomEvent("stocksy:sw-update", { detail: { apply: apply } }),
    );
  }

  // Reload exactly once, and only when the user chose to apply an update.
  // (controllerchange also fires on the very first install via clients.claim,
  // which must NOT reload the page.)
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (applying) {
      applying = false;
      window.location.reload();
    }
  });

  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(function (reg) {
        // An update that finished installing before this page loaded.
        if (reg.waiting && navigator.serviceWorker.controller) {
          announce(reg.waiting);
        }

        reg.addEventListener("updatefound", function () {
          var installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", function () {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              announce(installing);
            }
          });
        });

        // Long-lived installed apps rarely reload, so ask the browser to
        // re-check sw.js hourly and whenever the app returns to the foreground.
        setInterval(function () {
          reg.update().catch(function () {});
        }, 60 * 60 * 1000);
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") {
            reg.update().catch(function () {});
          }
        });
      })
      .catch(function (err) {
        console.warn("[PWA] Service worker registration failed:", err);
      });
  });
})();
