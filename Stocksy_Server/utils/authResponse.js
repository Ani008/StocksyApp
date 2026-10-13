// utils/authResponse.js
//
// Starts a session for an authenticated user and builds the login response.
// Shared by email/password signup + login and both Google login routes so the
// four of them cannot drift apart.

const sessions = require("../services/sessionService");
const { getAuthMode, setRefreshCookie } = require("./authCookies");

/**
 * user: a row from the users table (id, username, full_name, email, avatar,
 *       demo_balance).
 * Response keeps the original fields (id, username, fullName, email,
 * demoBalance, token) and adds expiresIn, plus refreshToken for native
 * clients. For the web the refresh token is ONLY in an httpOnly cookie and
 * is never present in the JSON body.
 */
async function respondWithNewSession(req, res, user, status = 200) {
  const mode = getAuthMode(req);
  const session = await sessions.createSession(user.id, mode, req);

  const body = {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    email: user.email,
    avatar: user.avatar,
    demoBalance: user.demo_balance,
    token: session.accessToken,
    expiresIn: session.expiresIn,
  };

  if (mode === "cookie") {
    setRefreshCookie(
      res,
      session.refreshToken,
      session.refreshExpiresAt.getTime() - Date.now(),
    );
  } else if (mode === "body") {
    body.refreshToken = session.refreshToken;
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

module.exports = { respondWithNewSession };
