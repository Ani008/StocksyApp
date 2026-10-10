/**
 * Pure helpers for the PWA update / install prompts.
 *
 * Kept free of React, react-native and browser globals (everything the
 * browser knows is passed in) so it can be unit-tested with `node --test`.
 */

export const INSTALL_MODE = {
  NONE: null,
  // Chrome / Edge / Samsung Internet: we hold a beforeinstallprompt event and
  // can open the browser's own install dialog from our button.
  NATIVE: "native",
  // iOS / iPadOS: no install API exists — we can only show instructions for
  // Share → Add to Home Screen.
  IOS: "ios",
};

// "Not now" on the install card hides it for a week, then it may return.
export const INSTALL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
// "Later" on the update bar hides it for 30 minutes, then it comes back.
// A stale bundle in a trading app is a risk, so it is never dismissed for good.
export const UPDATE_SNOOZE_MS = 30 * 60 * 1000;

/**
 * iPhone, iPod and iPad. Since iPadOS 13 iPads report a desktop-Mac user
 * agent ("MacIntel"), so they are told apart by having a touch screen.
 */
export function isIosDevice({ userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/**
 * True when the app is running as an installed PWA (home-screen launch)
 * rather than in a normal browser tab. iOS uses navigator.standalone, every
 * other browser uses the display-mode media query.
 */
export function isStandaloneDisplay({ displayModeStandalone = false, navigatorStandalone = false } = {}) {
  return displayModeStandalone === true || navigatorStandalone === true;
}

/** Whether a stored dismissal is still inside its snooze window. */
export function isSnoozed(dismissedAt, now, durationMs) {
  const at = Number(dismissedAt);
  if (!Number.isFinite(at) || at <= 0) return false;
  const elapsed = now - at;
  return elapsed >= 0 && elapsed < durationMs;
}

/**
 * Which install experience (if any) to offer right now.
 *
 * - already installed / running standalone → nothing
 * - we hold a native prompt                → native (works on Android & desktop)
 * - iOS and not installed                  → ios instructions
 * - anything else (desktop Safari, Firefox, …) → nothing; no way to help
 */
export function getInstallMode({ isStandalone, installed, hasNativePrompt, isIos }) {
  if (isStandalone || installed) return INSTALL_MODE.NONE;
  if (hasNativePrompt) return INSTALL_MODE.NATIVE;
  if (isIos) return INSTALL_MODE.IOS;
  return INSTALL_MODE.NONE;
}

/**
 * Developer test switch: `?pwa=update | install | ios` in the URL forces the
 * matching prompt to show so the UI can be checked without deploying twice
 * or owning an iPhone. Only honoured when `enabled` (dev builds, or
 * EXPO_PUBLIC_PWA_DEBUG=true), so real users can never trigger it.
 */
export function parseDebugFlag(search, enabled) {
  if (!enabled || typeof search !== "string") return null;
  const match = /[?&]pwa=([a-z]+)/i.exec(search);
  const value = match ? match[1].toLowerCase() : null;
  return value === "update" || value === "install" || value === "ios" ? value : null;
}
