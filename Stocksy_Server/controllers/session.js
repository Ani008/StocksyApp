// controllers/session.js — everything about an existing login session:
// issue (shared by every login route), refresh, whoami, logout, ws ticket.

const sessions = require("../services/sessionService");
const { issueTicket } = require("../services/wsTicketService");
const logger = require("../utils/logger");
const {
  REFRESH_COOKIE,
  setSessionCookies,
  clearSessionCookies,
  isWebClient,
  originOk,
  csrfTokenFor,
} = require("../utils/sessionCookies");

const fail = (res, status, code, message) =>
  res.status(status).json({ message, code, severity: "error" });

/**
 * Create a session for `user` and shape the login response.
 *
 *   web    (X-Client-Type: web) → tokens go ONLY in HttpOnly cookies. The JSON
 *                                 body carries the user and a CSRF token, never
 *                                 an access/refresh token.
 *   native (default)            → `token` (short access JWT) and `refreshToken`
 *                                 in the body, as before.
 */
async function startSession(req, res, user) {
  const web = isWebClient(req);
  const s = await sessions.createSession({
    userId: user.id,
    clientType: web ? "web" : "native",
    userAgent: req.get("user-agent"),
  });

  const profile = {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    email: user.email,
    avatar: user.avatar,
    demoBalance: user.demo_balance,
  };

  if (web) {
    setSessionCookies(res, s);
    return { ...profile, csrfToken: csrfTokenFor(s.sid), expiresIn: s.expiresIn };
  }
  return { ...profile, token: s.accessToken, refreshToken: s.refreshToken, expiresIn: s.expiresIn };
}

// POST /api/auth/refresh
//   web:    refresh token comes from the HttpOnly cookie
//   native: { refreshToken } in the body
const refresh = async (req, res) => {
  const web = isWebClient(req);

  if (web && !originOk(req)) {
    return fail(res, 403, "CSRF_FAILED", "Request blocked.");
  }

  const presented = web ? req.cookies?.[REFRESH_COOKIE] : req.body?.refreshToken;

  let r;
  try {
    r = await sessions.rotate(presented);
  } catch (err) {
    if (err.code === "RETRY") {
      // Another tab refreshed a moment ago; its new cookie is already set.
      return fail(res, 401, "REFRESH_RETRY", "Please try again.");
    }
    if (err.code === "REUSED") logger.warn("[SESSION] Refresh token reuse detected — session revoked");
    if (web) clearSessionCookies(res);
    if (!(err.code in { INVALID: 1, EXPIRED: 1, REUSED: 1 })) {
      logger.error(`[SESSION] refresh failed: ${err.message}`);
      return fail(res, 500, "UNKNOWN_ERROR", "Something went wrong. Please try again.");
    }
    return res.status(401).json({
      message: "Your session has expired. Please log in again.",
      code: "SESSION_EXPIRED",
      reason: "refresh_" + err.code.toLowerCase(),
      severity: "error",
    });
  }

  try {
    const user = await sessions.findUser(r.userId);
    if (!user) {
      await sessions.revokeSession(r.sid, "user_gone");
      if (web) clearSessionCookies(res);
      return fail(res, 401, "SESSION_EXPIRED", "Your session has expired. Please log in again.");
    }

    if (r.clientType === "web") {
      setSessionCookies(res, r);
      return res.json({ user: sessions.publicUser(user), csrfToken: csrfTokenFor(r.sid), expiresIn: r.expiresIn });
    }
    return res.json({ token: r.accessToken, refreshToken: r.refreshToken, expiresIn: r.expiresIn, user: sessions.publicUser(user) });
  } catch (err) {
    logger.error(`[SESSION] refresh failed: ${err.message}`);
    return fail(res, 500, "UNKNOWN_ERROR", "Something went wrong. Please try again.");
  }
};

// GET /api/auth/session — "am I logged in?" for a page that just loaded.
const getSession = (req, res) => {
  res.json({
    user: sessions.publicUser(req.user),
    csrfToken: req.auth.source === "cookie" ? csrfTokenFor(req.auth.sid) : undefined,
  });
};

// POST /api/auth/logout — always succeeds; revokes whatever session it can
// identify, and clears the cookies.
const logout = async (req, res) => {
  const web = isWebClient(req);
  try {
    if (web && !originOk(req)) return fail(res, 403, "CSRF_FAILED", "Request blocked.");

    const rt = web ? req.cookies?.[REFRESH_COOKIE] : req.body?.refreshToken;
    if (rt) await sessions.revokeByRefreshToken(rt, "logout");
  } catch (err) {
    logger.error(`[LOGOUT] ${err.message}`);
  }
  if (web) clearSessionCookies(res);
  res.status(200).json({ message: "Logged out successfully" });
};

// POST /api/auth/logout-all — sign out everywhere (protect + CSRF).
const logoutAll = async (req, res) => {
  try {
    await sessions.revokeAllForUser(req.user.id, "logout_all");
    if (req.auth.source === "cookie") clearSessionCookies(res);
    res.status(200).json({ message: "Logged out of all devices" });
  } catch (err) {
    logger.error(`[LOGOUT-ALL] ${err.message}`);
    fail(res, 500, "UNKNOWN_ERROR", "Something went wrong. Please try again.");
  }
};

// POST /api/auth/ws-ticket — one-time ticket for the WebSocket handshake.
const wsTicket = async (req, res) => {
  try {
    res.json(await issueTicket(req.user.id, req.auth.sid));
  } catch (err) {
    logger.error(`[WS-TICKET] ${err.message}`);
    fail(res, 500, "UNKNOWN_ERROR", "Something went wrong. Please try again.");
  }
};

module.exports = { startSession, refresh, getSession, logout, logoutAll, wsTicket };
