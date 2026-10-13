const bcrypt = require("bcryptjs");
const { pool } = require("../config/postgres");
const sessions = require("../services/sessionService");
const logger = require("../utils/logger");
const { respondWithNewSession } = require("../utils/authResponse");
const {
  getAuthMode,
  readCookie,
  REFRESH_COOKIE,
  setRefreshCookie,
  clearRefreshCookie,
} = require("../utils/authCookies");
const { sessionExpired } = require("../utils/authErrors");

const signupUser = async (req, res) => {
  console.log("\n───────────────────────────────────────");
  // SECURITY: never log req.body here — it contains the plaintext password.
  // Log only which fields are missing, never their values.
  console.log("[SIGNUP] Request received");

  const { fullName, email, password } = req.body;

  if (!fullName || !email || !password) {
    console.log(
      "[SIGNUP] ❌ Missing fields:",
      [
        !fullName && "fullName",
        !email && "email",
        !password && "password",
      ]
        .filter(Boolean)
        .join(", "),
    );
    return res
      .status(400)
      .json({
        message: "fullName, email and password are all required",
        code: "VALIDATION_ERROR",
        severity: "error",
      });
  }

  const username = fullName.trim().split(" ")[0];
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    console.log("[SIGNUP] Checking if user already exists...");
    const existing = await pool.query(
      `
SELECT *
FROM users
WHERE email=$1
`,
      [email],
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({
        message: "An account with this email already exists.",
        code: "EMAIL_ALREADY_EXISTS",
        severity: "error",
      });
    }

    console.log("[SIGNUP] Creating new user...");
    const result = await pool.query(
      `
INSERT INTO users(

full_name,
username,
email,
password

)

VALUES($1,$2,$3,$4)

RETURNING *
`,

      [fullName, username, email, hashedPassword],
    );

    const user = result.rows[0];
    console.log("[SIGNUP] ✅ User created:", user.id);

    await respondWithNewSession(req, res, user, 201);
  } catch (error) {
    // message only — the full pg error object includes row values
    // (e.g. the email in a "duplicate key" detail).
    console.error("[SIGNUP] ❌ Error:", error.message);
    res.status(500).json({
      message: "Something went wrong. Please try again.",
      code: "UNKNOWN_ERROR",
      severity: "error",
    });
  }
};

const loginUser = async (req, res) => {
  console.log("\n───────────────────────────────────────");
  // SECURITY: never log req.body here — it contains the plaintext password.
  console.log("[LOGIN] Request received");

  const { email, password } = req.body;

  if (!email || !password) {
    console.log(
      "[LOGIN] ❌ Missing fields:",
      [!email && "email", !password && "password"].filter(Boolean).join(", "),
    );
    return res.status(400).json({
      message: "email and password are required",
      code: "VALIDATION_ERROR",
      severity: "error",
    });
  }

  try {
    const result = await pool.query(
      `
SELECT *
FROM users
WHERE email=$1
`,

      [email],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
        severity: "error",
      });
    }

    const user = result.rows[0];

    console.log("[LOGIN] User found:", user.id, "— checking password...");
    const isMatch = await bcrypt.compare(
      password,

      user.password,
    );
    console.log("[LOGIN] Password match:", isMatch);

    if (isMatch) {
      console.log("[LOGIN] ✅ Login successful for:", user.username);
      await respondWithNewSession(req, res, user);
    } else {
      console.log("[LOGIN] ❌ Password did not match");
      res.status(401).json({
        message: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
        severity: "error",
      });
    }
  } catch (error) {
    console.error("[LOGIN] ❌ Error:", error.message);
    res.status(500).json({
      message: "Something went wrong. Please try again.",
      code: "UNKNOWN_ERROR",
      severity: "error",
    });
  }
};

// Where the refresh token comes from: the httpOnly cookie on the web, the
// request body on the native app.
const readRefreshToken = (req) =>
  getAuthMode(req) === "cookie"
    ? readCookie(req, REFRESH_COOKIE)
    : typeof req.body?.refreshToken === "string"
      ? req.body.refreshToken
      : null;

/**
 * POST /api/auth/refresh
 * Swaps a refresh token for a new access token and a NEW refresh token.
 * Any failure is SESSION_EXPIRED: the client has to log in again.
 */
const refreshSession = async (req, res) => {
  const mode = getAuthMode(req);
  res.setHeader("Cache-Control", "no-store");

  if (mode === "legacy") {
    // App builds from before refresh tokens have none to send.
    return sessionExpired(res);
  }

  try {
    const rotated = await sessions.rotateRefreshToken(readRefreshToken(req));

    if (!rotated) {
      if (mode === "cookie") clearRefreshCookie(res);
      return sessionExpired(res);
    }

    const body = {
      ...rotated.user,
      token: rotated.accessToken,
      expiresIn: rotated.expiresIn,
    };

    if (mode === "cookie") {
      setRefreshCookie(
        res,
        rotated.refreshToken,
        rotated.refreshExpiresAt.getTime() - Date.now(),
      );
    } else {
      body.refreshToken = rotated.refreshToken;
    }

    return res.status(200).json(body);
  } catch (error) {
    logger.error(`[REFRESH] ${error.message}`);
    return res.status(500).json({
      message: "Something went wrong. Please try again.",
      code: "UNKNOWN_ERROR",
      severity: "error",
    });
  }
};

/**
 * POST /api/auth/logout
 * Ends the session on the server. Deliberately does not require a valid
 * access token (short-lived ones are often already expired when a person
 * logs out) and always answers 200 so the client can finish clearing itself.
 */
const logoutUser = async (req, res) => {
  console.log("[LOGOUT] Request received");

  try {
    // 1. by refresh token (web cookie / native body)
    await sessions.revokeByRefreshToken(readRefreshToken(req), "logout");

    // 2. by the access token's session — covers app builds with no refresh
    //    token. The signature is still verified; only expiry is ignored.
    const header = req.headers.authorization || "";
    if (header.startsWith("Bearer ")) {
      try {
        const decoded = sessions.verifyAccessToken(header.split(" ")[1], {
          ignoreExpiration: true,
        });
        await sessions.revokeSession(decoded.sid, "logout");
      } catch {
        /* bad token: nothing to revoke */
      }
    }
  } catch (error) {
    logger.error(`[LOGOUT] ${error.message}`);
  }

  if (getAuthMode(req) === "cookie") clearRefreshCookie(res);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ message: "Logged out successfully" });
};

module.exports = {
  signupUser,
  loginUser,
  logoutUser,
  refreshSession,
};