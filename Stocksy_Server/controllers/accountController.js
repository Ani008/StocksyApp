const bcrypt = require("bcryptjs");
const { pool } = require("../config/postgres");
const { deleteAccount } = require("../repositories/accountDeletionRepository");
const logger = require("../utils/logger");
const sessions = require("../services/sessionService");
const { clearSessionCookies } = require("../utils/sessionCookies");

/**
 * DELETE /api/auth/account
 *
 * Requires the `protect` middleware, so req.user.id is already a
 * verified owner — nobody else can trigger this for another account.
 *
 * For local (email/password) accounts, the current password must be
 * re-confirmed in the body as an extra guard against someone deleting
 * an account from a device where the person just happened to be logged
 * in. Google accounts don't have a usable password on file (see
 * googleAuth.js — they're created with password: ''), so that check is
 * skipped for those; the frontend requires typing "DELETE" to confirm
 * instead.
 */
const deleteAccountHandler = async (req, res) => {
  const userId = req.user.id;

  try {
    if (req.user.provider === "local") {
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({
          message: "Please enter your password to confirm account deletion.",
          code: "VALIDATION_ERROR",
          severity: "error",
        });
      }

      const result = await pool.query(
        `SELECT password FROM users WHERE id = $1`,
        [userId],
      );

      const isMatch = await bcrypt.compare(password, result.rows[0]?.password || "");

      if (!isMatch) {
        return res.status(401).json({
          message: "Incorrect password.",
          code: "INVALID_CREDENTIALS",
          severity: "error",
        });
      }
    }

    const summary = await deleteAccount(userId);

    // The session rows are already gone (users ON DELETE CASCADE); this tells
    // any still-open WebSocket for that user to close right now.
    await sessions.revokeAllForUser(userId, "account_deleted").catch(() => {});
    if (req.auth?.source === "cookie") clearSessionCookies(res);

    logger.info(`[ACCOUNT DELETED] user=${userId}`, summary);

    res.status(200).json({
      message: "Your account has been permanently deleted.",
      ...summary,
    });
  } catch (error) {
    logger.error(`[DELETE ACCOUNT] ${error.message}`);
    res.status(500).json({
      message: "Something went wrong while deleting your account. Please try again.",
      code: "UNKNOWN_ERROR",
      severity: "error",
    });
  }
};

module.exports = { deleteAccountHandler };