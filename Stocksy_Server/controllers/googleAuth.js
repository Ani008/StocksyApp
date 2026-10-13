const { OAuth2Client } = require("google-auth-library");
const { pool } = require("../config/postgres");
const logger = require("../utils/logger");
const { respondWithNewSession } = require("../utils/authResponse");
const { normalizeEmail } = require("../utils/email");
const sessions = require("../services/sessionService");
const otp = require("../services/otpService");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const getAllowedWebRedirectUris = () => {
  return String(process.env.GOOGLE_WEB_REDIRECT_URIS || "")
    .split(",")
    .map((uri) => uri.trim())
    .filter(Boolean);
};

const googleError = (message, code, status) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.expose = true; // safe to show the person
  return error;
};

/**
 * Finds, links, claims or creates the Stocksy account for a verified Google
 * identity (security review item 7).
 *
 *   1. Already linked to this Google identity           -> that account.
 *   2. An account with the same email:
 *        - tied to a DIFFERENT Google identity          -> refuse, never merge.
 *        - email already confirmed (the owner proved it) -> link Google to it.
 *          Its password and provider are left alone.
 *        - email never confirmed                        -> Google just proved
 *          the mailbox, so this account is CLAIMED: its password is removed
 *          and every session on it revoked. Whoever created it without
 *          owning the address (the "pre-registered a victim's email" attack)
 *          loses their way in.
 *   3. Nothing                                          -> create a new account.
 */
const createOrUpdateGoogleUser = async (payload, attempt = 0) => {
  const googleId = payload.sub;
  const email = normalizeEmail(payload.email);
  const fullName = payload.name;
  const avatar = payload.picture;

  if (!googleId || !email) {
    const error = new Error("Google account information is incomplete.");
    error.code = "GOOGLE_AUTH_FAILED";
    throw error;
  }

  // Strictly `true`: some ID tokens carry the string "false", which is truthy.
  if (payload.email_verified !== true && payload.email_verified !== "true") {
    throw googleError(
      "Your Google email is not verified.",
      "GOOGLE_EMAIL_NOT_VERIFIED",
      401,
    );
  }

  const safeFullName = fullName?.trim() || email.split("@")[0];
  const username = safeFullName.split(/\s+/)[0];

  try {
    // 1. Already linked to this Google identity
    const linked = await pool.query(`SELECT * FROM users WHERE google_id = $1`, [googleId]);
    let user = linked.rows[0];

    if (user) {
      const updated = await pool.query(
        `UPDATE users
            SET full_name = $1, username = $2, avatar = $3
          WHERE id = $4
      RETURNING *`,
        [safeFullName, username, avatar, user.id],
      );
      return updated.rows[0];
    }

    // 2. An account with this email
    const byEmail = await pool.query(`SELECT * FROM users WHERE lower(email) = $1`, [email]);
    user = byEmail.rows[0];

    if (user) {
      if (user.google_id && user.google_id !== googleId) {
        throw googleError(
          "This email is already linked to a different Google account.",
          "GOOGLE_ACCOUNT_MISMATCH",
          409,
        );
      }

      if (user.email_verified) {
        const linkedNow = await pool.query(
          `UPDATE users
              SET full_name = $1, username = $2, google_id = $3, avatar = $4
            WHERE id = $5
        RETURNING *`,
          [safeFullName, username, googleId, avatar, user.id],
        );
        return linkedNow.rows[0];
      }

      const claimed = await pool.query(
        `UPDATE users
            SET full_name      = $1,
                username       = $2,
                google_id      = $3,
                provider       = 'google',
                avatar         = $4,
                password       = '',
                email_verified = TRUE,
                updated_at     = NOW()
          WHERE id = $5 AND email_verified = FALSE
      RETURNING *`,
        [safeFullName, username, googleId, avatar, user.id],
      );

      if (claimed.rows.length === 0) {
        // Confirmed by its owner a moment ago: start again, this time linking.
        if (attempt < 2) return createOrUpdateGoogleUser(payload, attempt + 1);
        throw new Error("Could not link the Google account.");
      }

      await sessions.revokeAllUserSessions(user.id, "google_claim");
      await otp.clearCodes(user.id);
      logger.info(`[GOOGLE AUTH] claimed an unverified account user=${user.id}`);
      return claimed.rows[0];
    }

    // 3. New account (Google has already verified the email)
    const created = await pool.query(
      `INSERT INTO users
         (full_name, username, email, password, provider, google_id, avatar, email_verified)
       VALUES ($1, $2, $3, '', 'google', $4, $5, TRUE)
       RETURNING *`,
      [safeFullName, username, email, googleId, avatar],
    );
    return created.rows[0];
  } catch (error) {
    // Someone created the same account a moment ago (unique index): look again.
    if (error.code === "23505" && attempt < 2) {
      return createOrUpdateGoogleUser(payload, attempt + 1);
    }
    throw error;
  }
};

/**
 * Existing native Google Sign-In endpoint.
 *
 * Android/iOS:
 * GoogleSignin → ID token → /auth/google
 */
const googleLogin = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        message: "Google ID Token is required",
        code: "VALIDATION_ERROR",
        severity: "error",
      });
    }

    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    const user = await createOrUpdateGoogleUser(payload);

    return await respondWithNewSession(req, res, user);
  } catch (err) {
    logger.error(`[GOOGLE AUTH] ${err.message}`);

    return res.status(err.status || 500).json({
      message: err.expose
        ? err.message
        : "Google authentication failed. Please try again.",
      code: err.code || "GOOGLE_AUTH_FAILED",
      severity: "error",
    });
  }
};

/**
 * Web Google OAuth endpoint.
 *
 * Browser:
 * Google → authorization code + PKCE
 *       → this endpoint
 *       → Google token exchange
 *       → ID token verification
 *       → Stocksy session (access token + refresh cookie)
 */
const googleWebLogin = async (req, res) => {
  try {
    const { code, codeVerifier, redirectUri } = req.body;

    if (!code || !codeVerifier || !redirectUri) {
      return res.status(400).json({
        message: "Google authorization data is incomplete.",
        code: "VALIDATION_ERROR",
        severity: "error",
      });
    }

    const allowedRedirectUris = getAllowedWebRedirectUris();

    if (!allowedRedirectUris.includes(redirectUri)) {
      logger.warn(`[GOOGLE WEB AUTH] Rejected redirect URI: ${redirectUri}`);

      return res.status(400).json({
        message: "Invalid Google redirect URI.",
        code: "INVALID_REDIRECT_URI",
        severity: "error",
      });
    }

    if (!process.env.GOOGLE_CLIENT_SECRET) {
      logger.error("[GOOGLE WEB AUTH] GOOGLE_CLIENT_SECRET is not configured.");

      return res.status(500).json({
        message: "Google web authentication is not configured.",
        code: "GOOGLE_AUTH_CONFIG_ERROR",
        severity: "error",
      });
    }

    const webClient = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri,
    );

    // Exchange authorization code + PKCE verifier for Google tokens.
    let tokens;

    try {
      const tokenResult = await webClient.getToken({
        code,
        codeVerifier,
        redirect_uri: redirectUri,
      });

      tokens = tokenResult.tokens;

      logger.info("[GOOGLE WEB AUTH] Google token exchange succeeded.");
    } catch (err) {
      logger.error(`[GOOGLE WEB AUTH] Token exchange failed: ${err.message}`);

      if (err.response?.data) {
        logger.error(
          `[GOOGLE WEB AUTH] Google response: ${JSON.stringify({
            error: err.response.data.error,
            error_description: err.response.data.error_description,
          })}`,
        );
      }

      throw err;
    }

    if (!tokens.id_token) {
      return res.status(401).json({
        message: "Google did not return an ID token.",
        code: "GOOGLE_AUTH_FAILED",
        severity: "error",
      });
    }

    // Verify the ID token server-side.
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    const user = await createOrUpdateGoogleUser(payload);

    return await respondWithNewSession(req, res, user);
  } catch (err) {
    logger.error(`[GOOGLE WEB AUTH] ${err.message}`);

    return res.status(err.status || 500).json({
      message: err.expose
        ? err.message
        : "Google authentication failed. Please try again.",
      code: err.code || "GOOGLE_AUTH_FAILED",
      severity: "error",
    });
  }
};

module.exports = {
  googleLogin,
  googleWebLogin,
};
