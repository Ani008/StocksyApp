// Registers /sw.js and tells the app when a NEW version has been downloaded
// and is waiting. The new version is only activated when the user asks for it
// (applyUpdate), never silently — see public/sw.js.

const SW_URL = "/sw.js";
// How often to look for a new deploy while the app stays open.
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
// If the waiting worker never takes over, reload anyway after this long.
const ACTIVATE_FALLBACK_MS = 4000;

let registration = null;
let refreshRequested = false;

function reload() {
  window.location.reload();
}

/**
 * @param {{ onUpdateReady: () => void }} handlers
 * @returns {() => void} cleanup
 */
export function registerServiceWorker({ onUpdateReady }) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }

  const sw = navigator.serviceWorker;
  let disposed = false;
  const cleanups = [];

  // "Update" only means something when an older version is already running.
  // On the very first visit there is no controller yet — that's an install,
  // not an update, so the user should not be asked to refresh.
  const hasRunningVersion = () => Boolean(sw.controller);

  const notifyIfWaiting = (reg) => {
    if (!disposed && reg.waiting && hasRunningVersion()) onUpdateReady();
  };

  const watchInstalling = (worker) => {
    if (!worker) return;
    const onChange = () => {
      if (worker.state === "installed" && hasRunningVersion() && !disposed) onUpdateReady();
    };
    worker.addEventListener("statechange", onChange);
    cleanups.push(() => worker.removeEventListener("statechange", onChange));
  };

  const checkForUpdate = () => {
    if (registration) registration.update().catch(() => {});
  };

  // Another tab (or our own applyUpdate) swapped the active worker. Only the
  // tab where the user tapped Refresh reloads; other tabs keep their state
  // and keep showing the banner.
  const onControllerChange = () => {
    if (refreshRequested) reload();
  };
  sw.addEventListener("controllerchange", onControllerChange);
  cleanups.push(() => sw.removeEventListener("controllerchange", onControllerChange));

  sw.register(SW_URL)
    .then((reg) => {
      registration = reg;
      if (disposed) return;
      notifyIfWaiting(reg);
      watchInstalling(reg.installing);
      const onUpdateFound = () => watchInstalling(reg.installing);
      reg.addEventListener("updatefound", onUpdateFound);
      cleanups.push(() => reg.removeEventListener("updatefound", onUpdateFound));
    })
    .catch((e) => {
      console.warn("[pwa] service worker registration failed:", e && e.message);
    });

  // Look for a new deploy on a timer AND whenever the app comes back to the
  // foreground / regains network — on iOS an installed PWA is frozen in the
  // background, so a timer alone would never fire for those users.
  const interval = setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
  cleanups.push(() => clearInterval(interval));

  const onVisibility = () => {
    if (document.visibilityState === "visible") checkForUpdate();
  };
  document.addEventListener("visibilitychange", onVisibility);
  cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
  window.addEventListener("online", checkForUpdate);
  cleanups.push(() => window.removeEventListener("online", checkForUpdate));

  return () => {
    disposed = true;
    cleanups.forEach((fn) => fn());
  };
}

/** Activates the waiting version and reloads onto it. */
export async function applyUpdate() {
  refreshRequested = true;
  let reg = registration;
  if (!reg && typeof navigator !== "undefined" && navigator.serviceWorker) {
    reg = await navigator.serviceWorker.getRegistration(SW_URL).catch(() => null);
  }
  if (reg && reg.waiting) {
    reg.waiting.postMessage({ type: "SKIP_WAITING" });
    // Normal path: the worker activates → controllerchange → reload.
    // Fallback in case that event never arrives.
    setTimeout(reload, ACTIVATE_FALLBACK_MS);
  } else {
    // No waiting worker (e.g. another tab already activated it): a plain
    // reload picks up the new bundle.
    reload();
  }
}
