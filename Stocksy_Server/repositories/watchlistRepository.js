const { pool } = require("../config/postgres");

// Every query that touches a watchlist is scoped by user_id, so one user can
// never read or change another user's list even if they guess its id.

// Postgres error code for a unique-constraint violation.
const UNIQUE_VIOLATION = "23505";

const isUniqueViolation = (err) => err && err.code === UNIQUE_VIOLATION;

// ── Read ─────────────────────────────────────────────────────────────────────

// All of a user's watchlists, oldest first, each with its items (oldest added
// first). Two small queries instead of a join so the shape stays simple.
const getWatchlistsByUser = async (userId) => {
  const lists = await pool.query(
    `
    SELECT id, name, created_at
    FROM watchlists
    WHERE user_id = $1
    ORDER BY created_at ASC, id ASC
    `,
    [userId],
  );

  if (lists.rows.length === 0) return [];

  const items = await pool.query(
    `
    SELECT i.watchlist_id, i.instrument_key, i.added_at
    FROM watchlist_items i
    JOIN watchlists w ON w.id = i.watchlist_id
    WHERE w.user_id = $1
    ORDER BY i.added_at ASC, i.id ASC
    `,
    [userId],
  );

  const byList = new Map();
  for (const row of items.rows) {
    if (!byList.has(row.watchlist_id)) byList.set(row.watchlist_id, []);
    byList.get(row.watchlist_id).push({
      instrument_key: row.instrument_key,
      added_at: row.added_at,
    });
  }

  return lists.rows.map((l) => ({ ...l, items: byList.get(l.id) || [] }));
};

// One list (only if it belongs to the user), with its items. undefined if not found.
const getWatchlistById = async ({ watchlistId, userId }) => {
  const list = await pool.query(
    `
    SELECT id, name, created_at
    FROM watchlists
    WHERE id = $1 AND user_id = $2
    `,
    [watchlistId, userId],
  );

  if (list.rows.length === 0) return undefined;

  const items = await pool.query(
    `
    SELECT instrument_key, added_at
    FROM watchlist_items
    WHERE watchlist_id = $1
    ORDER BY added_at ASC, id ASC
    `,
    [watchlistId],
  );

  return { ...list.rows[0], items: items.rows };
};

const countWatchlists = async (userId) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n FROM watchlists WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0].n;
};

const countItems = async (watchlistId) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n FROM watchlist_items WHERE watchlist_id = $1`,
    [watchlistId],
  );
  return result.rows[0].n;
};

// ── Write ────────────────────────────────────────────────────────────────────

// Throws a pg unique-violation error if the user already has a list with this
// name (case-insensitive) — the controller turns that into a friendly message.
const createWatchlist = async ({ userId, name }) => {
  const result = await pool.query(
    `
    INSERT INTO watchlists (user_id, name)
    VALUES ($1, $2)
    RETURNING id, name, created_at
    `,
    [userId, name],
  );

  return result.rows[0];
};

// Returns the deleted row, or undefined if it wasn't the user's list.
// Items go with it (ON DELETE CASCADE).
const deleteWatchlist = async ({ watchlistId, userId }) => {
  const result = await pool.query(
    `
    DELETE FROM watchlists
    WHERE id = $1 AND user_id = $2
    RETURNING id
    `,
    [watchlistId, userId],
  );

  return result.rows[0];
};

// Adds the stock to the user's list. Adding one that's already there is a
// no-op rather than an error. Returns false if the list isn't the user's.
const addItem = async ({ watchlistId, userId, instrumentKey }) => {
  const result = await pool.query(
    `
    INSERT INTO watchlist_items (watchlist_id, instrument_key)
    SELECT w.id, $3
    FROM watchlists w
    WHERE w.id = $1 AND w.user_id = $2
    ON CONFLICT (watchlist_id, instrument_key) DO NOTHING
    RETURNING id
    `,
    [watchlistId, userId, instrumentKey],
  );

  if (result.rows.length > 0) return true;

  // Nothing inserted: either it was already there (fine) or the list isn't theirs.
  const owned = await pool.query(
    `SELECT 1 FROM watchlists WHERE id = $1 AND user_id = $2`,
    [watchlistId, userId],
  );
  return owned.rows.length > 0;
};

// Removes the stock from the user's list. Removing one that isn't there is a
// no-op. Returns false if the list isn't the user's.
const removeItem = async ({ watchlistId, userId, instrumentKey }) => {
  await pool.query(
    `
    DELETE FROM watchlist_items
    WHERE watchlist_id = $1
      AND instrument_key = $3
      AND watchlist_id IN (SELECT id FROM watchlists WHERE id = $1 AND user_id = $2)
    `,
    [watchlistId, userId, instrumentKey],
  );

  const owned = await pool.query(
    `SELECT 1 FROM watchlists WHERE id = $1 AND user_id = $2`,
    [watchlistId, userId],
  );
  return owned.rows.length > 0;
};

module.exports = {
  isUniqueViolation,
  getWatchlistsByUser,
  getWatchlistById,
  countWatchlists,
  countItems,
  createWatchlist,
  deleteWatchlist,
  addItem,
  removeItem,
};
