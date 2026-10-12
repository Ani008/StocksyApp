const jwt = require("jsonwebtoken");
const logger = require("../utils/logger");
const sessions = require("../services/sessionService");
const {
  ACCESS_COOKIE,
  SAFE_METHODS,
  originOk,
  csrfValid,
} = require("../utils/sessionCookies");

// Who is calling?
//
//   Native apps  → `Authorization: Bearer <access token>`
//   Web (PWA)    → the HttpOnly `stocksy_at` cookie (JS never sees the token)
//
// A bearer header wins if both are present. Cookie-authenticated requests
// that change data must also pass the CSRF checks (see utils/sessionCookies).
//
// The access token is short-lived AND tied to a server-side session row, so
// logout / password reset / account deletion cut it off immediately instead
// of letting a stolen token live for 30 days.

const unauthorized = (res) =>
  res.status(401).json({
    message: "Please log in to continue.",
    code: "UNAUTHORIZED",
    severity: "error",
  });

// Code stays SESSION_EXPIRED (older app builds already handle it). `reason`
// lets newer clients tell "just refresh me" from "log in again".
const sessionExpired = (res, reason) =>
  res.status(401).json({
    message: "Your session has expired. Please log in again.",
    code: "SESSION_EXPIRED",
    reason,
    severity: "error",
  });

const protect = async (req, res, next) => {
  let token = null;
  let source = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
    source = "bearer";
  } else if (req.cookies && req.cookies[ACCESS_COOKIE]) {
    token = req.cookies[ACCESS_COOKIE];
    source = "cookie";
  }

  if (!token) return unauthorized(res);

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    logger.warn(`[AUTH] Token verification failed: ${err.name}`);
    return sessionExpired(res, err.name === "TokenExpiredError" ? "access_expired" : "invalid_token");
  }

  // Tokens from before sessions existed carry no `sid`; they cannot be
  // revoked, so they are no longer accepted.
  if (!decoded.sid || !decoded.id) return sessionExpired(res, "legacy_token");

  if (source === "cookie" && !SAFE_METHODS.has(req.method)) {
    if (!originOk(req) || !csrfValid(req, decoded.sid)) {
      logger.warn(`[AUTH] CSRF check failed: ${req.method} ${req.path}`);
      return res.status(403).json({
        message: "Request blocked. Please refresh the page and try again.",
        code: "CSRF_FAILED",
        severity: "error",
      });
    }
  }

  try {
    const user = await sessions.findActiveSessionUser(decoded.sid, decoded.id);
    if (!user) return sessionExpired(res, "revoked");

    req.user = user;
    req.auth = { sid: decoded.sid, source };
    next();
  } catch (err) {
    logger.error(`[AUTH] DB lookup failed: ${err.message}`);
    return res.status(500).json({
      message: "Something went wrong. Please try again.",
      code: "UNKNOWN_ERROR",
      severity: "error",
    });
  }
};

module.exports = { protect };
