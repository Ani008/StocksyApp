const { pool } = require("../config/postgres");
const { escapeLike } = require("../services/followLogic");

// Postgres error code for "that row points at a user that doesn't exist".
const FOREIGN_KEY_VIOLATION = "23503";
const isForeignKeyViolation = (err) => err && err.code === FOREIGN_KEY_VIOLATION;

// created_at as UTC text with microseconds — the paging cursor carries this
// exactly (see services/followLogic.js for why it must not go through a JS Date).
const CURSOR_TS = `to_char(f.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// The two ways to read the same table. Column names come from this fixed map,
// never from request input, so interpolating them into SQL below is safe.
//   followers of X → rows where X is following_id; the person listed is follower_id
//   following of X → rows where X is follower_id;  the person listed is following_id
const DIRECTIONS = {
  followers: { targetCol: "following_id", otherCol: "follower_id" },
  following: { targetCol: "follower_id", otherCol: "following_id" },
};

// ── Read ─────────────────────────────────────────────────────────────────────

const userExists = async (userId) => {
  const result = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
  return result.rows.length > 0;
};

// A user's public profile plus their relationship with the viewer.
// undefined if there is no such user.
const getProfile = async ({ userId, viewerId }) => {
  const result = await pool.query(
    `
    SELECT u.id,
           u.full_name,
           u.avatar,
           (SELECT COUNT(*)::int FROM follows WHERE following_id = u.id) AS followers_count,
           (SELECT COUNT(*)::int FROM follows WHERE follower_id  = u.id) AS following_count,
           EXISTS (SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = u.id) AS is_following,
           EXISTS (SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = $2) AS follows_you
    FROM users u
    WHERE u.id = $1
    `,
    [userId, viewerId],
  );

  return result.rows[0];
};

const countFollowers = async (userId) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n FROM follows WHERE following_id = $1`,
    [userId],
  );
  return result.rows[0].n;
};

// One page of a user's followers or following, newest first. Returns up to
// limit + 1 rows (the extra one tells the caller whether another page exists).
//   search — optional name filter within this list
//   cursor — optional { ts, id } from decodeCursor: continue after that row
const listConnections = async ({ direction, targetId, viewerId, search, cursor, limit }) => {
  const dir = DIRECTIONS[direction];
  if (!dir) throw new Error(`Unknown direction: ${direction}`);

  const params = [viewerId, targetId];
  let where = `f.${dir.targetCol} = $2`;

  if (search) {
    params.push(`%${escapeLike(search)}%`); // Postgres' default LIKE escape is a backslash
    where += ` AND u.full_name ILIKE $${params.length}`;
  }

  if (cursor) {
    params.push(cursor.ts, cursor.id);
    where += ` AND (f.created_at, f.${dir.otherCol}) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }

  params.push(limit + 1);

  const result = await pool.query(
    `
    SELECT u.id,
           u.full_name,
           u.avatar,
           ${CURSOR_TS} AS cursor_ts,
           EXISTS (SELECT 1 FROM follows v WHERE v.follower_id = $1 AND v.following_id = u.id) AS is_following,
           EXISTS (SELECT 1 FROM follows b WHERE b.follower_id = u.id AND b.following_id = $1) AS follows_you
    FROM follows f
    JOIN users u ON u.id = f.${dir.otherCol}
    WHERE ${where}
    ORDER BY f.created_at DESC, f.${dir.otherCol} DESC
    LIMIT $${params.length}
    `,
    params,
  );

  return result.rows;
};

// "Find people to follow": everyone (except the viewer) whose name contains the
// search text, names that START with it first. Only verified accounts — an
// unverified signup can't log in, so it isn't someone you could follow.
// Matches on name only, never email, so this can't be used to check whether a
// given email address has an account.
const searchUsers = async ({ viewerId, term, limit }) => {
  const escaped = escapeLike(term);

  const result = await pool.query(
    `
    SELECT u.id,
           u.full_name,
           u.avatar,
           EXISTS (SELECT 1 FROM follows v WHERE v.follower_id = $1 AND v.following_id = u.id) AS is_following,
           EXISTS (SELECT 1 FROM follows b WHERE b.follower_id = u.id AND b.following_id = $1) AS follows_you
    FROM users u
    WHERE u.id <> $1
      AND u.email_verified = TRUE
      AND u.full_name ILIKE $2
    ORDER BY (u.full_name ILIKE $3) DESC, LOWER(u.full_name) ASC, u.id ASC
    LIMIT $4
    `,
    [viewerId, `%${escaped}%`, `${escaped}%`, limit],
  );

  return result.rows;
};

// ── Write ────────────────────────────────────────────────────────────────────

// Following someone you already follow is a no-op, not an error. Throws a
// foreign-key violation if the target user doesn't exist (the controller turns
// that into a 404), so no separate "does this user exist" query is needed.
const follow = async ({ followerId, followingId }) => {
  await pool.query(
    `
    INSERT INTO follows (follower_id, following_id)
    VALUES ($1, $2)
    ON CONFLICT (follower_id, following_id) DO NOTHING
    `,
    [followerId, followingId],
  );
};

// Unfollowing someone you don't follow is a no-op.
const unfollow = async ({ followerId, followingId }) => {
  await pool.query(
    `DELETE FROM follows WHERE follower_id = $1 AND following_id = $2`,
    [followerId, followingId],
  );
};

module.exports = {
  isForeignKeyViolation,
  userExists,
  getProfile,
  countFollowers,
  listConnections,
  searchUsers,
  follow,
  unfollow,
};
