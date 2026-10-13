// utils/authCookies.js
//
// The web/PWA keeps its long-lived refresh token in an httpOnly cookie, so
// page JavaScript (and therefore any XSS bug) can never read it. The native
// app has no cookie jar it can rely on, so it receives the refresh token in
// the JSON body instead and keeps it in secure storage.
//
// The client says which one it is with the X-Auth-Mode header:
//     cookie  -> web/PWA
//     body    -> native app
//     (absent)-> an app build from before this change ("legacy"), see
//                services/sessionService.js
//
// Cookie settings (all optional env vars):
//     COOKIE_SAMESITE  lax (default) | strict | none
//                      Use "none" ONLY if the web app and the API are on
//                      different registrable domains (e.g. stocksy.pages.dev
//                      calling api.stocksy.online). app.stocksy.online +
//                      api.stocksy.online are the same site: keep "lax".
//     COOKIE_DOMAIN    leave unset (host-only cookie) unless you need it
//     COOKIE_SECURE    defaults to true in production

const { isOriginAllowed } = require("../config/cors");
const { sendError } = require("./authErrors");

const REFRESH_COOKIE = "stocksy_rt";
const COOKIE_PATH = "/api/auth"; // only sent to the auth endpoints

function getAuthMode(req) {
  const mode = String(req.headers["x-auth-mode"] || "").toLowerCase();
  if (mode === "cookie") return "cookie";
  if (mode === "body") return "body";
  return "legacy";
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

function cookieOptions() {
  const sameSite = String(process.env.COOKIE_SAMESITE || "lax").toLowerCase();
  const secureDefault = process.env.NODE_ENV === "production";
  const secure =
    process.env.COOKIE_SECURE === undefined
      ? secureDefault
      : process.env.COOKIE_SECURE === "true";
  const opts = {
    httpOnly: true,
    // Browsers refuse SameSite=None without Secure.
    secure: sameSite === "none" ? true : secure,
    sameSite,
    path: COOKIE_PATH,
  };
  if (process.env.COOKIE_DOMAIN) opts.domain = process.env.COOKIE_DOMAIN;
  return opts;
}

function setRefreshCookie(res, token, maxAgeMs) {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions(), maxAge: maxAgeMs });
}

function clearRefreshCookie(res) {
  // Attributes must match the ones used to set it or the browser keeps it.
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

/**
 * CSRF guard for the endpoints that act on the refresh cookie
 * (/auth/refresh, /auth/logout).
 *
 * A cookie is attached automatically by the browser, so we additionally
 * require:
 *   1. the custom header X-Auth-Mode: cookie — a header another website
 *      cannot add to a cross-site request without passing our CORS
 *      preflight, which only allows our own origins; and
 *   2. that any Origin the browser sent is on the allowlist.
 */
function cookieCsrfGuard(req, res, next) {
  const hasCookie = !!readCookie(req, REFRESH_COOKIE);
  const mode = getAuthMode(req);

  if (hasCookie && mode !== "cookie") {
    return sendError(res, 403, "Request blocked.", "FORBIDDEN");
  }
  if (mode === "cookie" && !isOriginAllowed(req.headers.origin)) {
    return sendError(res, 403, "Request blocked.", "FORBIDDEN");
  }
  return next();
}

module.exports = {
  REFRESH_COOKIE,
  getAuthMode,
  readCookie,
  setRefreshCookie,
  clearRefreshCookie,
  cookieCsrfGuard,
};
