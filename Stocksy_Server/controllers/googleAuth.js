const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/postgres");
const logger = require("../utils/logger");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};

const getAllowedWebRedirectUris = () => {
  return String(process.env.GOOGLE_WEB_REDIRECT_URIS || "")
    .split(",")
    .map((uri) => uri.trim())
    .filter(Boolean);
};

const createOrUpdateGoogleUser = async (payload) => {
  const googleId = payload.sub;
  const email = payload.email;
  const fullName = payload.name;
  const avatar = payload.picture;
  const emailVerified = payload.email_verified;

  if (!googleId || !email) {
    const error = new Error("Google account information is incomplete.");
    error.code = "GOOGLE_AUTH_FAILED";
    throw error;
  }

  if (!emailVerified) {
    const error = new Error("Your Google email is not verified.");
    error.code = "GOOGLE_EMAIL_NOT_VERIFIED";
    error.status = 401;
    throw error;
  }

  const safeFullName = fullName?.trim() || email.split("@")[0];
  const username = safeFullName.split(/\s+/)[0];

  const existing = await pool.query(
    `
    SELECT *
    FROM users
    WHERE email = $1
    `,
    [email],
  );

  let user;

  if (existing.rows.length > 0) {
    user = existing.rows[0];

    await pool.query(
      `
      UPDATE users
      SET
        full_name = $1,
        username = $2,
        google_id = $3,
        provider = 'google',
        avatar = $4
      WHERE id = $5
      `,
      [safeFullName, username, googleId, avatar, user.id],
    );

    user.full_name = safeFullName;
    user.username = username;
    user.google_id = googleId;
    user.provider = "google";
    user.avatar = avatar;
  } else {
    const created = await pool.query(
      `
      INSERT INTO users
      (
        full_name,
        username,
        email,
        password,
        provider,
        google_id,
        avatar
      )
      VALUES
      (
        $1,
        $2,
        $3,
        '',
        'google',
        $4,
        $5
      )
      RETURNING *
      `,
      [safeFullName, username, email, googleId, avatar],
    );

    user = created.rows[0];
  }

  return {
    id: user.id,
    fullName: user.full_name,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    demoBalance: user.demo_balance,
    token: generateToken(user.id),
  };
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

    const data = await createOrUpdateGoogleUser(payload);

    return res.json(data);
  } catch (err) {
    logger.error(`[GOOGLE AUTH] ${err.message}`);

    return res.status(err.status || 500).json({
      message:
        err.status === 401
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
 *       → Stocksy JWT
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

    const data = await createOrUpdateGoogleUser(payload);

    return res.json(data);
  } catch (err) {
    logger.error(`[GOOGLE WEB AUTH] ${err.message}`);

    return res.status(err.status || 500).json({
      message:
        err.status === 401
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
