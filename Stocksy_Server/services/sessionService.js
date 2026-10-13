// services/sessionService.js
//
// Server-tracked login sessions (security review items 1 and 2).
//
//   login ──► auth_sessions row (the session)
//         ├─► access token : short-lived JWT { id, sid }, HS256
//         └─► refresh token: random, one-time, stored HASHED in refresh_tokens
//
//   * Every request checks that the access token's session is still active
//     (middleware/auth.js → findActiveUser), so revoking a session ends it
//     at once instead of waiting for a JWT to expire.
//   * /auth/refresh swaps a refresh token for a new access token AND a new
//     refresh token (rotation). Presenting an already-used refresh token
//     after a short grace period is treated as theft and revokes the whole
//     session.
//   * Logout, password reset and account deletion revoke sessions; the
//     WebSocket layer listens to `events` and drops matching live sockets.
//
// Env (all optional):
//   ACCESS_TOKEN_TTL_SECONDS   default 900 (15 min)
//   REFRESH_TOKEN_TTL_DAYS     default 30  (absolute, counted from login)
//   LEGACY_TOKEN_TTL_SECONDS   default 2592000 (30 d). Lifetime of the access
//                              token given to app builds that predate refresh
//                              tokens. Still revocable. Set to 0 once old
//                              builds are gone to give them the short TTL too.

const crypto = require("crypto");
const { EventEmitter } = require("events");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/postgres");
const logger = require("../utils/logger");

const events = new EventEmitter();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A refresh token is single-use, but a flaky mobile connection or two browser
// tabs can legitimately present the same one twice within moments. Inside this
// window a second use is allowed; after it, reuse means the token leaked.
const REUSE_GRACE_MS = 10 * 1000;

const intEnv = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const accessTtlSeconds = () => intEnv("ACCESS_TOKEN_TTL_SECONDS", 15 * 60);
const refreshTtlSeconds = () => intEnv("REFRESH_TOKEN_TTL_DAYS", 30) * 86400;
const legacyTtlSeconds = () => {
  const v = intEnv("LEGACY_TOKEN_TTL_SECONDS", 30 * 86400);
  return v === 0 ? accessTtlSeconds() : v;
};

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const newRefreshToken = () => crypto.randomBytes(32).toString("base64url");

function signAccessToken(userId, sessionId, ttlSeconds) {
  return jwt.sign({ id: userId, sid: sessionId }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: ttlSeconds,
  });
}

/**
 * Verifies signature + expiry and that the token carries a session id.
 * Tokens issued before sessions existed have no `sid` and are rejected, which
 * is what makes the old 30-day tokens stop working once this ships.
 * Throws on any problem.
 */
function verifyAccessToken(token, { ignoreExpiration = false } = {}) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ["HS256"],
    ignoreExpiration,
  });
  if (!decoded || !decoded.id || typeof decoded.sid !== "string" || !UUID_RE.test(decoded.sid)) {
    throw new Error("token has no session");
  }
  return decoded;
}

/** The user row for a verified token, or null if the session is not active. */
async function findActiveUser(decoded) {
  const result = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.email, u.provider, u.google_id,
            u.avatar, u.demo_balance
       FROM users u
       JOIN auth_sessions s ON s.user_id = u.id
      WHERE u.id = $1
        AND s.id = $2
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()`,
    [decoded.id, decoded.sid],
  );
  return result.rows[0] || null;
}

async function insertRefreshToken(sessionId, expiresAt) {
  const token = newRefreshToken();
  await pool.query(
    `INSERT INTO refresh_tokens (session_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [sessionId, sha256(token), expiresAt],
  );
  return token;
}

/**
 * Start a session for a freshly authenticated user.
 * mode: "cookie" | "body" | "legacy" (see utils/authCookies.getAuthMode)
 * Returns { accessToken, refreshToken|null, expiresIn, refreshExpiresAt, sessionId }
 */
async function createSession(userId, mode, req) {
  const refreshSeconds = refreshTtlSeconds();
  const expiresAt = new Date(Date.now() + refreshSeconds * 1000);

  const inserted = await pool.query(
    `INSERT INTO auth_sessions (user_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      userId,
      expiresAt,
      String(req?.headers?.["user-agent"] || "").slice(0, 300) || null,
      String(req?.ip || "").slice(0, 64) || null,
    ],
  );
  const sessionId = inserted.rows[0].id;

  // Opportunistic housekeeping so the tables don't grow forever.
  if (Math.random() < 0.02) cleanupExpired().catch(() => {});

  if (mode === "legacy") {
    const ttl = legacyTtlSeconds();
    return {
      sessionId,
      accessToken: signAccessToken(userId, sessionId, ttl),
      refreshToken: null,
      expiresIn: ttl,
      refreshExpiresAt: expiresAt,
    };
  }

  const ttl = accessTtlSeconds();
  return {
    sessionId,
    accessToken: signAccessToken(userId, sessionId, ttl),
    refreshToken: await insertRefreshToken(sessionId, expiresAt),
    expiresIn: ttl,
    refreshExpiresAt: expiresAt,
  };
}

/**
 * Exchange a refresh token for a new access token + rotated refresh token.
 * Returns the same shape as createSession plus { user }, or null when the
 * token is unknown, expired, reused, or its session is no longer active.
 */
async function rotateRefreshToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length > 200) return null;
  const hash = sha256(rawToken);

  // Atomic "claim": only one concurrent caller can flip used_at from NULL.
  const claimed = await pool.query(
    `UPDATE refresh_tokens
        SET used_at = NOW()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
  RETURNING session_id`,
    [hash],
  );

  let sessionId = claimed.rows[0]?.session_id;

  if (!sessionId) {
    const prior = await pool.query(
      `SELECT session_id, used_at, expires_at FROM refresh_tokens WHERE token_hash = $1`,
      [hash],
    );
    const row = prior.rows[0];
    if (!row || new Date(row.expires_at) <= new Date()) return null;

    const usedAgo = row.used_at ? Date.now() - new Date(row.used_at).getTime() : Infinity;
    if (usedAgo > REUSE_GRACE_MS) {
      // An old, already-rotated token came back: someone has a copy.
      logger.warn(`[SESSION] refresh token reuse detected, revoking session ${row.session_id}`);
      await revokeSession(row.session_id, "token_reuse");
      return null;
    }
    sessionId = row.session_id; // benign double-submit inside the grace window
  }

  const session = await pool.query(
    `SELECT s.id, s.user_id, s.expires_at,
            u.full_name, u.username, u.email, u.provider, u.avatar, u.demo_balance
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()`,
    [sessionId],
  );
  const s = session.rows[0];
  if (!s) return null;

  const ttl = accessTtlSeconds();
  return {
    sessionId: s.id,
    accessToken: signAccessToken(s.user_id, s.id, ttl),
    refreshToken: await insertRefreshToken(s.id, s.expires_at),
    expiresIn: ttl,
    refreshExpiresAt: s.expires_at,
    user: {
      id: s.user_id,
      username: s.username,
      fullName: s.full_name,
      email: s.email,
      avatar: s.avatar,
      demoBalance: s.demo_balance,
    },
  };
}

async function revokeSession(sessionId, reason) {
  if (!UUID_RE.test(String(sessionId))) return;
  const result = await pool.query(
    `UPDATE auth_sessions
        SET revoked_at = NOW(), revoke_reason = $2
      WHERE id = $1 AND revoked_at IS NULL
  RETURNING user_id`,
    [sessionId, reason],
  );
  if (result.rows.length) events.emit("session-revoked", { sessionId });
}

/** Revoke by refresh token (logout on a device that no longer has a valid access token). */
async function revokeByRefreshToken(rawToken, reason) {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length > 200) return;
  const found = await pool.query(
    `SELECT session_id FROM refresh_tokens WHERE token_hash = $1`,
    [sha256(rawToken)],
  );
  if (found.rows[0]) await revokeSession(found.rows[0].session_id, reason);
}

/** Password reset / security events: sign the user out everywhere. */
async function revokeAllUserSessions(userId, reason) {
  await pool.query(
    `UPDATE auth_sessions
        SET revoked_at = NOW(), revoke_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
  events.emit("user-sessions-revoked", { userId: String(userId) });
}

async function cleanupExpired() {
  await pool.query(
    `DELETE FROM auth_sessions
      WHERE expires_at < NOW() - INTERVAL '7 days'
         OR revoked_at < NOW() - INTERVAL '7 days'`,
  );
}

module.exports = {
  events,
  signAccessToken,
  verifyAccessToken,
  findActiveUser,
  createSession,
  rotateRefreshToken,
  revokeSession,
  revokeByRefreshToken,
  revokeAllUserSessions,
  cleanupExpired,
  accessTtlSeconds,
};
