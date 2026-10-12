const { pool } = require("../config/postgres");

// Keep a runaway client from piling up rows for one account.
const MAX_SUBSCRIPTIONS_PER_USER = 10;

// Insert, or move an existing endpoint to this user (see migration 013).
const upsertSubscription = async ({ userId, endpoint, p256dh, auth, userAgent }) => {
  const result = await pool.query(
    `
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (endpoint) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth,
          user_agent = EXCLUDED.user_agent
    RETURNING id
    `,
    [userId, endpoint, p256dh, auth, userAgent || null],
  );

  // Trim to the newest N for this user.
  await pool.query(
    `
    DELETE FROM push_subscriptions
    WHERE user_id = $1
      AND id NOT IN (
        SELECT id FROM push_subscriptions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      )
    `,
    [userId, MAX_SUBSCRIPTIONS_PER_USER],
  );

  return result.rows[0];
};

const listForUser = async (userId) => {
  const result = await pool.query(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId],
  );
  return result.rows;
};

// Scoped to the owner so one user can't unsubscribe someone else's device.
const deleteByEndpoint = async ({ userId, endpoint }) => {
  const result = await pool.query(
    `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
    [userId, endpoint],
  );
  return result.rowCount;
};

// Used when the push service says the subscription is gone (404/410).
const deleteById = async (id) => {
  await pool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [id]);
};

const markSuccess = async (id) => {
  await pool.query(`UPDATE push_subscriptions SET last_success = NOW() WHERE id = $1`, [id]);
};

module.exports = {
  MAX_SUBSCRIPTIONS_PER_USER,
  upsertSubscription,
  listForUser,
  deleteByEndpoint,
  deleteById,
  markSuccess,
};
