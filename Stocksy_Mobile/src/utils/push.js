/**
 * Pure helpers for web push. No React, react-native or browser globals
 * (everything the browser knows is passed in) so `node --test` can run them.
 */

export const PUSH_STATE = {
  // This browser can't do push at all (or the service worker isn't running).
  UNSUPPORTED: "unsupported",
  // The server has no VAPID keys / push is switched off.
  UNAVAILABLE: "unavailable",
  // iPhone/iPad: push only works for the app installed to the Home Screen.
  NEEDS_INSTALL: "needs-install",
  // The user blocked notifications in the browser; only they can undo it.
  BLOCKED: "blocked",
  OFF: "off",
  ON: "on",
};

export function derivePushState({
  supported = false,
  serverEnabled = true,
  isIos = false,
  standalone = false,
  permission = "default",
  hasSubscription = false,
} = {}) {
  // On iOS the Push API only exists inside the installed PWA, so "not
  // supported" there really means "not installed yet" — say so.
  if (isIos && !standalone) return PUSH_STATE.NEEDS_INSTALL;
  if (!supported) return PUSH_STATE.UNSUPPORTED;
  if (!serverEnabled) return PUSH_STATE.UNAVAILABLE;
  if (permission === "denied") return PUSH_STATE.BLOCKED;
  if (permission === "granted" && hasSubscription) return PUSH_STATE.ON;
  return PUSH_STATE.OFF;
}

/** VAPID public key (base64url) -> Uint8Array for pushManager.subscribe. */
export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

// Which screen each notification link opens. Anything unknown opens nothing.
const OPEN_TARGETS = {
  alerts: "Alerts",
  orders: "OrderHistory",
};

/** "?open=alerts" -> "Alerts" | null */
export function parseOpenTarget(search = "") {
  const match = /[?&]open=([a-z]+)/i.exec(search);
  if (!match) return null;
  return OPEN_TARGETS[match[1].toLowerCase()] || null;
}

/** The SW sends a url like "/?open=alerts" with NOTIFICATION_CLICK. */
export function targetFromUrl(url = "") {
  const i = url.indexOf("?");
  return i === -1 ? null : parseOpenTarget(url.slice(i));
}

/** Serialise a PushSubscription into the body /api/push/subscribe expects. */
export function subscriptionToBody(sub) {
  const json = typeof sub.toJSON === "function" ? sub.toJSON() : sub;
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys && json.keys.p256dh, auth: json.keys && json.keys.auth },
  };
}
