const logger = require("../utils/logger");
const sessions = require("../services/sessionService");

// Still one Postgres lookup per authenticated request — but it is now a single
// query that checks the user AND that the token's login session has not been
// revoked, which is what makes logout / password reset / account deletion
// actually end a session (security review item 2).

const unauthorized = (res) =>
  res.status(401).json({
    message: "Please log in to continue.",
    code: "UNAUTHORIZED",
    severity: "error",
  });

const sessionExpired = (res) =>
  res.status(401).json({
    message: "Your session has expired. Please log in again.",
    code: "SESSION_EXPIRED",
    severity: "error",
  });

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return unauthorized(res);
  }

  const token = authHeader.split(" ")[1];

  let decoded;
  try {
    decoded = sessions.verifyAccessToken(token);
  } catch (err) {
    // Malformed, expired, or an old pre-session token. The web/native client
    // answers SESSION_EXPIRED by trying its refresh token once, then falling
    // back to the full-screen re-login.
    logger.error(`[AUTH] Token verification failed: ${err.message}`);
    return sessionExpired(res);
  }

  try {
    const user = await sessions.findActiveUser(decoded);

    if (!user) {
      // Valid signature, but the session was revoked/expired or the user is
      // gone — session-expired from the client's point of view.
      return sessionExpired(res);
    }

    req.user = user;
    req.sessionId = decoded.sid;
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
