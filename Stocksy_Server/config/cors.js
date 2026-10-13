// config/cors.js
//
// One place that decides which BROWSER origins may talk to this server.
// Used by the CORS middleware (server.js), the cookie-endpoint CSRF guard
// (utils/authCookies.js) and the WebSocket upgrade check
// (services/websocketService.js), so the three can never disagree.
//
// CORS_ORIGINS = comma-separated list of the exact origins of the web/PWA
// front end, e.g.
//     CORS_ORIGINS=https://app.stocksy.online,https://www.stocksy.online
//
// IMPORTANT: this is the origin of the WEB APP (where the page is served
// from), NOT the API's own origin (api.stocksy.online).
//
// Requests with no Origin header (the native Android/iOS app, curl,
// server-to-server calls such as backend_py) are not browser cross-origin
// requests and are not affected by CORS; they must still authenticate.

const isProd = () => process.env.NODE_ENV === "production";

const normalize = (origin) =>
  String(origin || "").trim().replace(/\/+$/, "").toLowerCase();

const parseOrigins = (raw) =>
  new Set(
    String(raw || "")
      .split(",")
      .map(normalize)
      .filter(Boolean),
  );

let cache = { raw: undefined, set: new Set() };

function allowedOrigins() {
  const raw = process.env.CORS_ORIGINS;
  if (cache.raw !== raw) cache = { raw, set: parseOrigins(raw) };
  return cache.set;
}

// Local development only: Expo web / dev servers on this machine.
const LOCAL_DEV = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * true  -> no Origin header (not a browser cross-origin request), or the
 *          origin is on the allowlist.
 * false -> a browser is calling from an origin we do not trust.
 */
function isOriginAllowed(origin) {
  if (!origin) return true;
  const o = normalize(origin);
  if (allowedOrigins().has(o)) return true;
  if (!isProd() && LOCAL_DEV.test(o)) return true;
  return false;
}

function warnIfMisconfigured(log = console.warn) {
  if (isProd() && allowedOrigins().size === 0) {
    log(
      "[CORS] CORS_ORIGINS is empty in production: browsers on any web origin " +
        "will be blocked. Set it to your web app's origin(s).",
    );
  }
}

const corsOptions = {
  // cb(null, false) -> no CORS headers, browser blocks the call. (Throwing an
  // Error here would turn every blocked preflight into a 500.)
  origin: (origin, cb) => cb(null, isOriginAllowed(origin)),
  credentials: true, // lets the refresh-token cookie travel
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Auth-Mode",
    "X-Idempotency-Key",
  ],
  maxAge: 600,
};

module.exports = { isOriginAllowed, corsOptions, warnIfMisconfigured };
