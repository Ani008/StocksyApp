// utils/sessionCookies.js
//
// Cookie + CSRF helpers for the WEB client. Native apps never use these:
// they keep sending `Authorization: Bearer <access token>`.
//
//   stocksy_at  access token  HttpOnly, Secure, Path=/            (JS cannot read it)
//   stocksy_rt  refresh token HttpOnly, Secure, Path=/api/auth    (only sent to auth routes)
//
// CSRF: cookies are sent automatically by the browser, so a request that
// authenticates by COOKIE must also prove it came from our own page:
//   1. X-CSRF-Token header = HMAC(JWT_SECRET, session id). The page learns
//      it from the login/refresh/session response body, so another site
//      cannot know it.
//   2. If the browser sent an Origin header it must be on the allowlist.
//   (Plus SameSite=Lax on the cookies.)
// Requests authenticated by an Authorization header need none of this —
// browsers never attach that header on their own.

const crypto = require("crypto");
const { isAllowedOrigin, isProduction } = require("../config/origins");

const ACCESS_COOKIE = "stocksy_at";
const REFRESH_COOKIE = "stocksy_rt";
const REFRESH_PATH = "/api/auth";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const secure = () => {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return isProduction();
};

const sameSite = () => {
  const v = String(process.env.COOKIE_SAMESITE || "lax").toLowerCase();
  return ["lax", "strict", "none"].includes(v) ? v : "lax";
};

function baseOptions(path) {
  const ss = sameSite();
  return {
    httpOnly: true,
    // SameSite=None is rejected by browsers unless Secure is set.
    secure: secure() || ss === "none",
    sameSite: ss,
    path,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
}

function setSessionCookies(res, { accessToken, refreshToken, refreshMaxAgeMs }) {
  // The access cookie outlives the JWT inside it on purpose: an expired JWT
  // gives a clear "access expired" 401 that tells the page to refresh.
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseOptions("/"), maxAge: refreshMaxAgeMs });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseOptions(REFRESH_PATH), maxAge: refreshMaxAgeMs });
}

function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, baseOptions("/"));
  res.clearCookie(REFRESH_COOKIE, baseOptions(REFRESH_PATH));
}

// The web client marks itself with this header. It is a custom header, so a
// browser must send a CORS preflight first, and the preflight is refused for
// any origin that is not on the allowlist.
const isWebClient = (req) => String(req.get("x-client-type") || "").toLowerCase() === "web";

// No Origin header (same-origin GET, non-browser) is fine; if there is one it
// has to be ours.
const originOk = (req) => {
  const origin = req.get("origin");
  return !origin || isAllowedOrigin(origin);
};

const csrfTokenFor = (sid) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET).update(`csrf:${sid}`).digest("hex");

function csrfValid(req, sid) {
  const sent = req.get("x-csrf-token");
  if (!sent || !sid) return false;
  const a = Buffer.from(String(sent));
  const b = Buffer.from(csrfTokenFor(sid));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  SAFE_METHODS,
  setSessionCookies,
  clearSessionCookies,
  isWebClient,
  originOk,
  csrfTokenFor,
  csrfValid,
};
