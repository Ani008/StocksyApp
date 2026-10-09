// The version numbers themselves are never hardcoded here — they come from
// GET /api/app/version.

// Official Google Play listing used for the "Update now" action.
// NOTE: your app.json says android.package = com.stocksy.app. This must match
// the package of the build you actually publish on Google Play.
export const PLAY_STORE_PACKAGE = "com.stocksy.app";

// Skipped in __DEV__ unless you set EXPO_PUBLIC_ENABLE_UPDATE_CHECK_IN_DEV=true
export const ENABLE_IN_DEV = process.env.EXPO_PUBLIC_ENABLE_UPDATE_CHECK_IN_DEV === "true";

// Fast-test mode: only when running in dev AND the dev flag above is on.
// Release builds have __DEV__ === false, so they always use the real values.
export const FAST_TEST_MODE = __DEV__ && ENABLE_IN_DEV;

// Production: at most one check per hour. Fast-test mode: every 15 seconds.
export const VERSION_CHECK_INTERVAL_MS = FAST_TEST_MODE ? 15 * 1000 : 60 * 60 * 1000;
// How long to wait after a failed check before retrying (5 s in fast-test mode).
export const FAILED_ATTEMPT_BACKOFF_MS = FAST_TEST_MODE ? 5 * 1000 : 5 * 60 * 1000;
// Fast-test mode only: re-check on a timer so you don't have to background the app.
export const FAST_TEST_POLL_MS = 20 * 1000;
export const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // "Later" hides for 24h
export const VERSION_REQUEST_TIMEOUT_MS = 6000;

export const STORAGE_KEY_SERVER_INFO = "appUpdate.serverInfo";
export const STORAGE_KEY_DISMISSED = "appUpdate.dismissed";

export const GENERIC_SERVER_MESSAGES = ["", "new version available", "new version available."];
export const FALLBACK_BODY = "Update Stocksy to get the latest features and improvements.";