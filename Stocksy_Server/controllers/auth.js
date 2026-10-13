const bcrypt = require("bcryptjs");
const { pool } = require("../config/postgres");
const sessions = require("../services/sessionService");
const otp = require("../services/otpService");
const throttle = require("../services/loginThrottle");
const { sendCode } = require("../services/codeDelivery");
const logger = require("../utils/logger");
const { respondWithNewSession } = require("../utils/authResponse");
const { normalizeEmail } = require("../utils/email");
const {
  hashPassword,
  getDummyHash,
  isBcryptHash,
  needsRehash,
  validatePassword,
} = require("../utils/password");
const {
  getAuthMode,
  readCookie,
  REFRESH_COOKIE,
  setRefreshCookie,
  clearRefreshCookie,
} = require("../utils/authCookies");
const { sendError, sessionExpired } = require("../utils/authErrors");

const MAX_NAME_LENGTH = 150; // users.full_name is VARCHAR(150)
const MAX_PASSWORD_INPUT = 1024; // sanity bound on what we are willing to hash/compare

const unknownError = (res) =>
  sendError(res, 500, "Something went wrong. Please try again.", "UNKNOWN_ERROR");

const invalidCredentials = (res) =>
  sendError(res, 401, "Invalid credentials", "INVALID_CREDENTIALS");

const invalidCode = (res) =>
  sendError(res, 400, "That code is invalid or has expired.", "OTP_INVALID");

const accountLocked = (res, retryAfterSeconds) => {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return sendError(
    res,
    429,
    `Too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`,
    "ACCOUNT_LOCKED",
  );
};

const verificationRequired = (res, email, status) =>
  res.status(status).json({
    requiresVerification: true,
    email,
    message: `We sent a 6-digit code to ${email}. Enter it to confirm your email.`,
  });

/**
 * POST /api/auth/signup
 *
 * Creates the account but does NOT log anyone in: the address has to be
 * confirmed with a code first (POST /api/auth/verify-email). That is what
 * stops someone registering an email address they do not own.
 */
const signupUser = async (req, res) => {
  console.log("\n───────────────────────────────────────");
  // SECURITY: never log req.body here — it contains the plaintext password.
  console.log("[SIGNUP] Request received");

  const { fullName, password } = req.body || {};
  const email = normalizeEmail(req.body?.email);

  if (
    typeof fullName !== "string" ||
    !fullName.trim() ||
    !req.body?.email ||
    typeof password !== "string" ||
    !password
  ) {
    return sendError(
      res,
      400,
      "fullName, email and password are all required",
      "VALIDATION_ERROR",
    );
  }

  if (!email) {
    return sendError(res, 400, "Enter a valid email address.", "VALIDATION_ERROR");
  }

  const name = fullName.trim();
  if (name.length > MAX_NAME_LENGTH) {
    return sendError(res, 400, "That name is too long.", "VALIDATION_ERROR");
  }

  const policy = validatePassword(password, { email, fullName: name });
  if (!policy.ok) {
    return sendError(res, 400, policy.message, "WEAK_PASSWORD");
  }

  const username = name.split(/\s+/)[0].slice(0, 50);

  try {
    // Hash first so the time taken does not depend on whether the email exists.
    const hashedPassword = await hashPassword(password);

    const existing = await pool.query(
      `SELECT id, full_name, email, email_verified FROM users WHERE lower(email) = $1`,
      [email],
    );

    if (existing.rows.length > 0) {
      const account = existing.rows[0];

      if (account.email_verified) {
        return sendError(
          res,
          400,
          "An account with this email already exists.",
          "EMAIL_ALREADY_EXISTS",
        );
      }

      // Someone started signing up with this address and never confirmed it.
      // Leave that account exactly as it is (its stored password/name stay put
      // so a stranger cannot overwrite them) and send a fresh code. Whoever
      // proves they own the mailbox chooses the password in verify-email.
      await sendCode(account, otp.PURPOSES.EMAIL_VERIFY);
      return verificationRequired(res, email, 202);
    }

    console.log("[SIGNUP] Creating new user...");
    const created = await pool.query(
      `INSERT INTO users (full_name, username, email, password, email_verified)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, full_name, email`,
      [name, username, email, hashedPassword],
    );

    const user = created.rows[0];
    console.log("[SIGNUP] ✅ User created:", user.id);

    await sendCode(user, otp.PURPOSES.EMAIL_VERIFY);
    return verificationRequired(res, email, 202);
  } catch (error) {
    // Two signups for one address at the same moment: the unique index lets
    // one win. Treat the loser like a repeat signup.
    if (error.code === "23505") return verificationRequired(res, email, 202);

    // message only — the full pg error object includes row values
    // (e.g. the email in a "duplicate key" detail).
    console.error("[SIGNUP] ❌ Error:", error.message);
    return unknownError(res);
  }
};

/**
 * POST /api/auth/verify-email   { email, code, password }
 *
 * Confirms the mailbox and starts the first session.
 *
 * `password` is the password the person is using right now (the one they just
 * typed at signup or login). If it is the one already on the account nothing
 * changes; if it differs, it becomes the account's password. Either way a
 * password set before the mailbox was proven (for example by someone who
 * pre-registered this address) is replaced by the owner's.
 */
const verifyEmail = async (req, res) => {
  const { code, password } = req.body || {};
  const email = normalizeEmail(req.body?.email);

  if (
    !email ||
    typeof code !== "string" ||
    typeof password !== "string" ||
    !password ||
    password.length > MAX_PASSWORD_INPUT
  ) {
    return sendError(res, 400, "email, code and password are required", "VALIDATION_ERROR");
  }

  try {
    const result = await pool.query(
      `SELECT id, full_name, email, password, email_verified FROM users WHERE lower(email) = $1`,
      [email],
    );
    const user = result.rows[0];

    // Unknown address, already verified, wrong/expired/used code: one answer.
    if (!user || user.email_verified) return invalidCode(res);
    if (!(await otp.checkCode(user.id, otp.PURPOSES.EMAIL_VERIFY, code))) {
      return invalidCode(res);
    }

    // The code is right. Now settle the password; a rejected password leaves
    // the code usable so the person can try another.
    let newHash = null;
    const same = isBcryptHash(user.password) && (await bcrypt.compare(password, user.password));
    if (!same) {
      const policy = validatePassword(password, { email: user.email, fullName: user.full_name });
      if (!policy.ok) return sendError(res, 400, policy.message, "WEAK_PASSWORD");
      newHash = await hashPassword(password);
    }

    if (!(await otp.consumeCode(user.id, otp.PURPOSES.EMAIL_VERIFY, code))) {
      return invalidCode(res); // lost a race with another request using the same code
    }

    const updated = await pool.query(
      `UPDATE users
          SET email_verified = TRUE,
              password       = COALESCE($2, password),
              updated_at     = NOW()
        WHERE id = $1 AND email_verified = FALSE
    RETURNING *`,
      [user.id, newHash],
    );
    if (updated.rows.length === 0) return invalidCode(res);

    // Nothing logged in before the mailbox was proven may stay logged in.
    await sessions.revokeAllUserSessions(user.id, "email_verified");
    await throttle.clear(email);

    return await respondWithNewSession(req, res, updated.rows[0]);
  } catch (error) {
    logger.error(`[VERIFY EMAIL] ${error.message}`);
    return unknownError(res);
  }
};

/**
 * POST /api/auth/resend-verification   { email }
 * Always answers the same, whether or not the address has an unverified account.
 */
const resendVerification = async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  if (!email) {
    return sendError(res, 400, "Enter a valid email address.", "VALIDATION_ERROR");
  }

  try {
    const result = await pool.query(
      `SELECT id, full_name, email, email_verified FROM users WHERE lower(email) = $1`,
      [email],
    );
    const user = result.rows[0];

    if (user && !user.email_verified) {
      await sendCode(user, otp.PURPOSES.EMAIL_VERIFY);
    }

    return res.status(200).json({
      success: true,
      message: "If that email needs confirming, we have sent a new code.",
    });
  } catch (error) {
    logger.error(`[RESEND VERIFICATION] ${error.message}`);
    return unknownError(res);
  }
};

const loginUser = async (req, res) => {
  console.log("\n───────────────────────────────────────");
  // SECURITY: never log req.body here — it contains the plaintext password.
  console.log("[LOGIN] Request received");

  const { password } = req.body || {};
  const email = normalizeEmail(req.body?.email);

  if (!req.body?.email || typeof password !== "string" || !password) {
    return sendError(res, 400, "email and password are required", "VALIDATION_ERROR");
  }
  if (!email || password.length > MAX_PASSWORD_INPUT) {
    return sendError(res, 400, "Enter a valid email and password.", "VALIDATION_ERROR");
  }

  try {
    // Locked accounts are refused before any password work. This is the same
    // for an email with no account, so it reveals nothing.
    const lock = await throttle.check(email);
    if (lock.locked) return accountLocked(res, lock.retryAfterSeconds);

    const result = await pool.query(`SELECT * FROM users WHERE lower(email) = $1`, [email]);
    const user = result.rows[0];

    // Always do one bcrypt comparison. With no account (or a Google-only
    // account with no password) compare against a dummy hash, so a wrong
    // password and an unknown email take the same time.
    const stored = user && isBcryptHash(user.password) ? user.password : null;
    const matched = await bcrypt.compare(password, stored || (await getDummyHash()));

    if (!stored || !matched) {
      console.log("[LOGIN] ❌ Login failed");
      const nowLocked = await throttle.recordFailure(email);
      if (nowLocked) return accountLocked(res, throttle.lockSeconds());
      return invalidCredentials(res);
    }

    await throttle.clear(email);

    // Right password, but the mailbox was never confirmed.
    if (!user.email_verified) {
      await sendCode(user, otp.PURPOSES.EMAIL_VERIFY);
      return res.status(403).json({
        message: "Please confirm your email. We sent you a code.",
        code: "EMAIL_NOT_VERIFIED",
        severity: "error",
        email,
      });
    }

    // Quietly move old, cheaper hashes up to the current cost.
    if (needsRehash(user.password)) {
      try {
        await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [
          await hashPassword(password),
          user.id,
        ]);
      } catch (error) {
        logger.error(`[LOGIN] rehash failed: ${error.message}`);
      }
    }

    console.log("[LOGIN] ✅ Login successful for:", user.username);
    return await respondWithNewSession(req, res, user);
  } catch (error) {
    console.error("[LOGIN] ❌ Error:", error.message);
    return unknownError(res);
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
    return unknownError(res);
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
  verifyEmail,
  resendVerification,
  logoutUser,
  refreshSession,
};
