// The version numbers themselves are never hardcoded here — they come from
// GET /api/app/version.

// Official Google Play listing used for the "Update now" action.
// NOTE: your app.json says android.package = com.stocksy.app. This must match
// the package of the build you actually publish on Google Play.
export const PLAY_STORE_PACKAGE = "com.stocksy.app";

export const VERSION_CHECK_INTERVAL_MS = 60 * 60 * 1000; // at most once an hour
export const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // "Later" hides for 24h
export const VERSION_REQUEST_TIMEOUT_MS = 6000;

export const STORAGE_KEY_SERVER_INFO = "appUpdate.serverInfo";
export const STORAGE_KEY_DISMISSED = "appUpdate.dismissed";

export const GENERIC_SERVER_MESSAGES = ["", "new version available", "new version available."];
export const FALLBACK_BODY = "Update Stocksy to get the latest features and improvements.";

// Skipped in __DEV__ unless you set EXPO_PUBLIC_ENABLE_UPDATE_CHECK_IN_DEV=true
export const ENABLE_IN_DEV = process.env.EXPO_PUBLIC_ENABLE_UPDATE_CHECK_IN_DEV === "true";