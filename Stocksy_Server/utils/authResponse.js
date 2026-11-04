// utils/authResponse.js
//
// Starts a session for an authenticated user and builds the login response.
// Shared by email/password signup + login and both Google login routes so the
// four of them cannot drift apart.

const sessions = require("../services/sessionService");
const { serializeAccount } = require("../services/profileLogic");
const { getAuthMode, setRefreshCookie } = require("./authCookies");

/**
 * user: a row from the users table (id, username, username_set, full_name,
 *       email, avatar, avatar_id, demo_balance).
 * Response keeps the original fields (id, username, fullName, email, avatar,
 * demoBalance, token), adds usernameSet and avatarId (see
 * services/profileLogic.js serializeAccount — the app uses them to decide
 * whether to show the "choose a username / avatar" box), and adds expiresIn,
 * plus refreshToken for native clients. For the web the refresh token is ONLY
 * in an httpOnly cookie and is never present in the JSON body.
 */
async function respondWithNewSession(req, res, user, status = 200) {
  const mode = getAuthMode(req);
  const session = await sessions.createSession(user.id, mode, req);

  const body = {
    ...serializeAccount(user),
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
