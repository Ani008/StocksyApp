// services/sessionStore.js — Postgres storage for auth_sessions.
// Kept separate from sessionService so the rules (rotation, reuse detection)
// can be unit-tested with an in-memory store, while this file's SQL is
// checked against a real Postgres.

const { pool } = require("../config/postgres");

const USER_COLUMNS = `u.id, u.full_name, u.username, u.email, u.provider,
                      u.google_id, u.avatar, u.demo_balance`;

const ACTIVE = `s.revoked_at IS NULL AND s.expires_at > NOW() AND s.absolute_expires_at > NOW()`;

const store = {
  async insert({ userId, refreshHash, clientType, userAgent, expiresAt, absoluteExpiresAt }) {
    const { rows } = await pool.query(
      `INSERT INTO auth_sessions
         (user_id, refresh_hash, client_type, user_agent, expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, refreshHash, clientType, userAgent, expiresAt, absoluteExpiresAt],
    );
    return rows[0];
  },

  // Matches the CURRENT or the PREVIOUS refresh token of a session.
  async findByRefreshHash(hash) {
    const { rows } = await pool.query(
      `SELECT * FROM auth_sessions WHERE refresh_hash = $1 OR prev_refresh_hash = $1 LIMIT 1`,
      [hash],
    );
    return rows[0] || null;
  },

  // Atomic swap: only succeeds if `oldHash` is still the current token and
  // the session is not revoked, so two racing refreshes cannot both win.
  async rotate({ id, oldHash, newHash, expiresAt }) {
    const { rowCount } = await pool.query(
      `UPDATE auth_sessions
          SET prev_refresh_hash = refresh_hash,
              refresh_hash = $3,
              rotated_at = NOW(),
              expires_at = $4
        WHERE id = $1 AND refresh_hash = $2 AND revoked_at IS NULL`,
      [id, oldHash, newHash, expiresAt],
    );
    return rowCount === 1;
  },

  async revoke(id, reason) {
    await pool.query(
      `UPDATE auth_sessions SET revoked_at = NOW(), revoked_reason = $2
        WHERE id = $1 AND revoked_at IS NULL`,
      [id, reason],
    );
  },

  async revokeAllForUser(userId, reason) {
    const { rows } = await pool.query(
      `UPDATE auth_sessions SET revoked_at = NOW(), revoked_reason = $2
        WHERE user_id = $1 AND revoked_at IS NULL
        RETURNING id`,
      [userId, reason],
    );
    return rows.map((r) => r.id);
  },

  // The user for an access token, but ONLY if its session is still alive.
  async findActiveSessionUser(sid, userId) {
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS}
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND u.id = $2 AND ${ACTIVE}`,
      [sid, userId],
    );
    return rows[0] || null;
  },

  async findUser(userId) {
    const { rows } = await pool.query(
      `SELECT id, full_name, username, email, provider, google_id, avatar, demo_balance
         FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0] || null;
  },

  // Which of these session ids are still alive? (used to drop live sockets)
  async activeIds(ids) {
    if (!ids.length) return [];
    const { rows } = await pool.query(
      `SELECT s.id FROM auth_sessions s WHERE s.id = ANY($1::uuid[]) AND ${ACTIVE}`,
      [ids],
    );
    return rows.map((r) => r.id);
  },

  async deleteOld() {
    const { rowCount } = await pool.query(
      `DELETE FROM auth_sessions
        WHERE GREATEST(expires_at, absolute_expires_at) < NOW() - INTERVAL '7 days'
           OR revoked_at < NOW() - INTERVAL '7 days'`,
    );
    return rowCount;
  },
};

module.exports = store;
