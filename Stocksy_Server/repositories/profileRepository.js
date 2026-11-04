const { pool } = require("../config/postgres");

// Postgres error code for a unique-constraint violation, and the name of the
// index in migrations/022_username_avatar.sql that makes usernames unique.
const UNIQUE_VIOLATION = "23505";
const USERNAME_INDEX = "uq_users_username";

// True only when the error is "that username is already taken" — not some
// other unique violation.
const isUsernameTakenError = (err) =>
  Boolean(err) && err.code === UNIQUE_VIOLATION && err.constraint === USERNAME_INDEX;

// Is this username already someone's? Only chosen usernames count: the old
// first-name values and not-yet-confirmed signups reserve nothing.
// `exceptUserId` lets a person keep their own username.
const isUsernameTaken = async (username, exceptUserId = null) => {
  const result = await pool.query(
    `
    SELECT 1
    FROM users
    WHERE username_set
      AND LOWER(username) = $1
      AND ($2::uuid IS NULL OR id <> $2::uuid)
    `,
    [username, exceptUserId],
  );
  return result.rows.length > 0;
};

// Applies only the fields given ({ fullName?, username?, avatarId? }) and
// returns the person's updated account row, or undefined if they don't exist.
// Choosing a username marks it as chosen (username_set). If the username was
// taken in the meantime this throws the unique violation that
// isUsernameTakenError recognises — the index, not a pre-check, is what makes
// two people picking the same name at once safe.
const updateProfile = async (userId, { fullName, username, avatarId }) => {
  const params = [userId];
  const sets = [];

  if (fullName !== undefined) {
    params.push(fullName);
    sets.push(`full_name = $${params.length}`);
  }
  if (username !== undefined) {
    params.push(username);
    sets.push(`username = $${params.length}`, `username_set = TRUE`);
  }
  if (avatarId !== undefined) {
    params.push(avatarId);
    sets.push(`avatar_id = $${params.length}`);
  }
  sets.push(`updated_at = NOW()`);

  const result = await pool.query(
    `
    UPDATE users
    SET ${sets.join(", ")}
    WHERE id = $1
    RETURNING id, full_name, username, username_set, email, avatar, avatar_id, demo_balance
    `,
    params,
  );

  return result.rows[0];
};

module.exports = { isUsernameTakenError, isUsernameTaken, updateProfile };
