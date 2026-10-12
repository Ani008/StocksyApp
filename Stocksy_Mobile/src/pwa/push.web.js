// Web push for the PWA: opt-in, subscribe, unsubscribe, keep the server's
// copy of this browser's subscription in sync, and receive "notification was
// clicked" messages from the service worker.

import {
  PUSH_STATE,
  derivePushState,
  subscriptionToBody,
  targetFromUrl,
  urlBase64ToUint8Array,
} from "../utils/push";
import { isIosDevice, isStandaloneDisplay } from "../utils/pwa";
import {
  getPushConfig,
  registerPushSubscription,
  removePushSubscription,
} from "../../services/pushService";

const READY_TIMEOUT_MS = 3000;

let cachedConfig = null; // { enabled, publicKey }
let configPromise = null;

function browserSupportsPush() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function readEnv() {
  return {
    isIos: isIosDevice({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    }),
    standalone: isStandaloneDisplay({
      displayModeStandalone:
        typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches,
      navigatorStandalone: navigator.standalone === true,
    }),
  };
}

// serviceWorker.ready never resolves if no worker is registered (dev builds),
// so don't wait on it forever.
async function getRegistration() {
  if (!browserSupportsPush()) return null;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), READY_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

async function loadConfig() {
  if (cachedConfig) return cachedConfig;
  if (!configPromise) {
    configPromise = getPushConfig()
      .then((c) => {
        cachedConfig = c;
        return c;
      })
      .catch(() => null)
      .finally(() => {
        configPromise = null;
      });
  }
  return configPromise;
}

/** Fetch the VAPID key ahead of time (call on mount). Permission prompts must
 *  start straight from a tap, so the key can't be fetched after the tap. */
export function prefetchPushConfig() {
  loadConfig();
}

export async function getPushState() {
  const env = typeof navigator === "undefined" ? { isIos: false, standalone: false } : readEnv();
  const supported = browserSupportsPush();
  if (!supported) {
    return derivePushState({ supported: false, ...env });
  }

  const config = await loadConfig();
  const reg = await getRegistration();
  if (!reg) {
    return derivePushState({ supported: false, ...env });
  }

  const sub = await reg.pushManager.getSubscription();
  return derivePushState({
    supported: true,
    serverEnabled: config ? config.enabled !== false : true,
    permission: Notification.permission,
    hasSubscription: Boolean(sub),
    ...env,
  });
}

/** Must be called directly from a tap/click. Returns the new PUSH_STATE. */
export async function enablePush() {
  if (!browserSupportsPush()) return getPushState();

  // Ask first, while we are still inside the user's tap.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return getPushState();

  const config = await loadConfig();
  if (!config || !config.enabled || !config.publicKey) {
    return PUSH_STATE.UNAVAILABLE;
  }

  const reg = await getRegistration();
  if (!reg) return PUSH_STATE.UNSUPPORTED;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    });
  }

  try {
    await registerPushSubscription(subscriptionToBody(sub));
  } catch (err) {
    // Server refused it: don't leave a browser subscription the server
    // doesn't know about.
    await sub.unsubscribe().catch(() => {});
    throw err;
  }
  return PUSH_STATE.ON;
}

/** Turn off for this browser: tell the server, then drop the subscription. */
export async function disablePush() {
  const reg = await getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  try {
    await removePushSubscription(sub.endpoint);
  } catch {
    // Offline or already signed out: still remove it on this device. The
    // server prunes dead endpoints the first time a push to it fails.
  }
  await sub.unsubscribe().catch(() => {});
}

/** Re-register an existing subscription for whoever is signed in NOW.
 *  The server moves the endpoint to this user, so a different person logging
 *  in on a shared browser doesn't leave the previous user's alerts going here.
 *  Quiet: never prompts, never throws. */
export async function syncExistingSubscription() {
  try {
    if (!browserSupportsPush() || Notification.permission !== "granted") return;
    const reg = await getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    await registerPushSubscription(subscriptionToBody(sub));
  } catch {
    // Best effort.
  }
}

/** Calls onTarget("Alerts" | "OrderHistory") when a notification is tapped
 *  while the app is already open, and re-syncs after a rotated subscription. */
export function listenForNotificationClicks(onTarget) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }
  const handler = (event) => {
    const data = event.data || {};
    if (data.type === "NOTIFICATION_CLICK") {
      const target = targetFromUrl(data.url);
      if (target) onTarget(target);
    } else if (data.type === "PUSH_SUBSCRIPTION_CHANGED") {
      syncExistingSubscription();
    }
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
