const bcrypt = require("bcryptjs");
const { pool } = require("../config/postgres");
const sendForgotPasswordEmail = require("../utils/sendForgotPasswordEmail");
const logger = require("../utils/logger");
const sessions = require("../services/sessionService");

// ===============================
// Send OTP
// ===============================
const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
        code: "VALIDATION_ERROR",
        severity: "error",
      });
    }

    const userResult = await pool.query(
      `SELECT id, full_name, email
       FROM users
       WHERE email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email.",
        code: "USER_NOT_FOUND",
        severity: "error",
      });
    }

    const user = userResult.rows[0];

    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    const expiry = new Date(Date.now() + 5 * 60 * 1000);

    await pool.query(
      `UPDATE users
       SET otp = $1,
           otp_expires_at = $2
       WHERE id = $3`,
      [otp, expiry, user.id]
    );

    await sendForgotPasswordEmail({
      email: user.email,
      name: user.full_name,
      otp,
    });

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully.",
    });
  } catch (err) {
    logger.error(`[SEND OTP] ${err.message}`);
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again.",
      code: "UNKNOWN_ERROR",
      severity: "error",
    });
  }
};

// ===============================
// Verify OTP
// ===============================
const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required.",
        code: "VALIDATION_ERROR",
        severity: "error",
      });
    }

    const result = await pool.query(
      `SELECT otp, otp_expires_at
       FROM users
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
        code: "USER_NOT_FOUND",
        severity: "error",
      });
    }

    const user = result.rows[0];

    if (!user.otp) {
      return res.status(400).json({
        success: false,
        message: "Please request a new OTP.",
        code: "OTP_NOT_REQUESTED",
        severity: "error",
      });
    }

    if (user.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP.",
        code: "OTP_INVALID",
        severity: "error",
      });
    }

    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired.",
        code: "OTP_EXPIRED",
        severity: "error",
      });
    }

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully.",
    });

  } catch (err) {
    logger.error(`[VERIFY OTP] ${err.message}`);
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again.",
      code: "UNKNOWN_ERROR",
      severity: "error",
    });
  }
};

// ===============================
// Reset Password
// ===============================
const resetPassword = async (req, res) => {
  try {

    const { email, otp, password } = req.body;

    if (!email || !otp || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required.",
        code: "VALIDATION_ERROR",
        severity: "error",
      });
    }

    const result = await pool.query(
      `SELECT id, otp, otp_expires_at
       FROM users
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
        code: "USER_NOT_FOUND",
        severity: "error",
      });
    }

    const user = result.rows[0];

    if (user.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP.",
        code: "OTP_INVALID",
        severity: "error",
      });
    }

    if (new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({
        success: false,
        message: "OTP expired.",
        code: "OTP_EXPIRED",
        severity: "error",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `UPDATE users
       SET password = $1,
           otp = NULL,
           otp_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [hashedPassword, user.id]
    );

    // Whoever knew the old password (or already held a session) is signed out
    // everywhere. This is the point of a reset after a suspected break-in.
    await sessions.revokeAllForUser(user.id, "password_reset");

    return res.status(200).json({
      success: true,
      message: "Password reset successful.",
    });

  } catch (err) {
    logger.error(`[RESET PASSWORD] ${err.message}`);
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again.",
      code: "UNKNOWN_ERROR",
      severity: "error",
    });
  }
};

module.exports = {
  sendOtp,
  verifyOtp,
  resetPassword,
};