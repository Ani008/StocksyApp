const { pool } = require("../config/postgres");
const logger = require("../utils/logger");
const sessions = require("../services/sessionService");
const otp = require("../services/otpService");
const throttle = require("../services/loginThrottle");
const { sendCode } = require("../services/codeDelivery");
const { normalizeEmail } = require("../utils/email");
const { hashPassword, validatePassword } = require("../utils/password");
const { sendError } = require("../utils/authErrors");

// Password reset (security review item 8).
//
//   send-otp      -> e-mails a 6-digit code (if the account exists)
//   verify-otp    -> "is this code right?" for the UI; does not use it up
//   reset-password-> checks the code again, uses it up, sets the password
//
// What changed from the first version: codes are random, hashed at rest, die
// after 5 wrong guesses and after one use, sending is rate-limited per account,
// and no answer here reveals whether an e-mail has an account.

const MAX_PASSWORD_INPUT = 1024;

const unknownError = (res) =>
  res.status(500).json({
    success: false,
    message: "Something went wrong. Please try again.",
    code: "UNKNOWN_ERROR",
    severity: "error",
  });

// One answer for: no such account, no code requested, wrong code, expired
// code, code already used, too many wrong guesses.
const invalidCode = (res) =>
  res.status(400).json({
    success: false,
    message: "That code is invalid or has expired.",
    code: "OTP_INVALID",
    severity: "error",
  });

const findUser = async (email) => {
  const result = await pool.query(
    `SELECT id, full_name, email FROM users WHERE lower(email) = $1`,
    [email],
  );
  return result.rows[0] || null;
};

// ===============================
// Send OTP
// ===============================
const sendOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address.",
        code: "VALIDATION_ERROR",
        severity: "error",
      });
    }

    const user = await findUser(email);

    if (user) {
      await sendCode(user, otp.PURPOSES.PASSWORD_RESET);
    }

    // Same answer whether or not the account exists (or the send was throttled).
    return res.status(200).json({
      success: true,
      message: "If an account exists for that email, we have sent a 6-digit code.",
    });
  } catch (err) {
    logger.error(`[SEND OTP] ${err.message}`);
    return unknownError(res);
  }
};

// ===============================
// Verify OTP
// ===============================
const verifyOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = req.body?.otp;

    if (!email || typeof code !== "string" || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and code are required.",
        code: "VALIDATION_ERROR",
        severity: "error",
      });
    }

    const user = await findUser(email);

    if (!user || !(await otp.checkCode(user.id, otp.PURPOSES.PASSWORD_RESET, code))) {
      return invalidCode(res);
    }

    return res.status(200).json({
      success: true,
      message: "Code verified.",
    });
  } catch (err) {
    logger.error(`[VERIFY OTP] ${err.message}`);
    return unknownError(res);
  }
};

// ===============================
// Reset Password
// ===============================
const resetPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const { otp: code, password } = req.body || {};

    if (
      !email ||
      typeof code !== "string" ||
      !code ||
      typeof password !== "string" ||
      !password ||
      password.length > MAX_PASSWORD_INPUT
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required.",
        code: "VALIDATION_ERROR",
        severity: "error",
      });
    }

    const user = await findUser(email);

    if (!user || !(await otp.checkCode(user.id, otp.PURPOSES.PASSWORD_RESET, code))) {
      return invalidCode(res);
    }

    // A rejected password leaves the code usable, so the person can pick
    // another without starting over.
    const policy = validatePassword(password, { email: user.email, fullName: user.full_name });
    if (!policy.ok) {
      return sendError(res, 400, policy.message, "WEAK_PASSWORD");
    }

    const hashedPassword = await hashPassword(password);

    // Atomic: of several resets racing with one code, exactly one gets through.
    if (!(await otp.consumeCode(user.id, otp.PURPOSES.PASSWORD_RESET, code))) {
      return invalidCode(res);
    }

    // Having read the code from the mailbox also proves the address is theirs.
    await pool.query(
      `UPDATE users
          SET password       = $1,
              email_verified = TRUE,
              updated_at     = NOW()
        WHERE id = $2`,
      [hashedPassword, user.id],
    );

    // Any other code still outstanding for this account is now moot.
    await otp.clearCodes(user.id);

    // A reset means the old password may have been compromised: end every
    // existing login session (all devices) and drop their live sockets.
    await sessions.revokeAllUserSessions(user.id, "password_reset");

    // Lift any failed-login lockout so the person can log in with the new password.
    await throttle.clear(email);

    return res.status(200).json({
      success: true,
      message: "Password reset successful.",
    });
  } catch (err) {
    logger.error(`[RESET PASSWORD] ${err.message}`);
    return unknownError(res);
  }
};

module.exports = {
  sendOtp,
  verifyOtp,
  resetPassword,
};
