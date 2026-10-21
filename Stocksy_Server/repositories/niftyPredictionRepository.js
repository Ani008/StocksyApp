const { pool } = require("../config/postgres");

// Every read/write of a user's call is scoped by user_id, so one user can never
// see or change another user's prediction even by guessing ids.

// ── Read ─────────────────────────────────────────────────────────────────────

const getPredictionForDay = async (userId, tradeDate) => {
  const { rows } = await pool.query(
    `
    SELECT id, trade_date::text AS trade_date, direction, baseline_price,
           status, close_price, created_at, resolved_at
    FROM nifty_predictions
    WHERE user_id = $1 AND trade_date = $2
    `,
    [userId, tradeDate],
  );
  return rows[0] || null;
};

// A user's settled calls plus anything pending, newest first. Capped: streak
// maths only needs the recent run, and a heavy user should not make this
// request grow without bound.
const getRecentPredictions = async (userId, limit = 400) => {
  const { rows } = await pool.query(
    `
    SELECT trade_date::text AS trade_date, direction, status
    FROM nifty_predictions
    WHERE user_id = $1
    ORDER BY trade_date DESC
    LIMIT $2
    `,
    [userId, limit],
  );
  return rows;
};

// ── Write ────────────────────────────────────────────────────────────────────

// Insert today's call. Returns { row, created }:
//   created = true   this call just locked in
//   created = false  the user had already called today; `row` is the original
//                    (a double tap, or a second device — never overwritten)
const insertPrediction = async ({ userId, tradeDate, direction, baselinePrice }) => {
  const inserted = await pool.query(
    `
    INSERT INTO nifty_predictions (user_id, trade_date, direction, baseline_price)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, trade_date) DO NOTHING
    RETURNING id, trade_date::text AS trade_date, direction, baseline_price,
              status, close_price, created_at, resolved_at
    `,
    [userId, tradeDate, direction, baselinePrice],
  );
  if (inserted.rows[0]) return { row: inserted.rows[0], created: true };

  const existing = await getPredictionForDay(userId, tradeDate);
  return { row: existing, created: false };
};

// ── Settling ─────────────────────────────────────────────────────────────────

// Store the day's close once. Whoever gets there first wins; a later run (job
// restart, second server instance) gets back the SAME number, so a day can
// never be settled against two different closes.
const saveDailyClose = async (tradeDate, closePrice) => {
  await pool.query(
    `
    INSERT INTO nifty_daily_close (trade_date, close_price)
    VALUES ($1, $2)
    ON CONFLICT (trade_date) DO NOTHING
    `,
    [tradeDate, closePrice],
  );
  const { rows } = await pool.query(
    `SELECT close_price::float8 AS close_price FROM nifty_daily_close WHERE trade_date = $1`,
    [tradeDate],
  );
  return rows[0] ? rows[0].close_price : null;
};

const getDailyClose = async (tradeDate) => {
  const { rows } = await pool.query(
    `SELECT close_price::float8 AS close_price FROM nifty_daily_close WHERE trade_date = $1`,
    [tradeDate],
  );
  return rows[0] ? rows[0].close_price : null;
};

// Every day that still has PENDING calls and is not later than `upToDate`.
// Covers the normal case (today) and any day the job missed (server was down
// at the close) so nothing is left pending forever.
const getPendingDays = async (upToDate) => {
  const { rows } = await pool.query(
    `
    SELECT DISTINCT trade_date::text AS trade_date
    FROM nifty_predictions
    WHERE status = 'PENDING' AND trade_date <= $1
    ORDER BY trade_date ASC
    `,
    [upToDate],
  );
  return rows.map((r) => r.trade_date);
};

// Settle every PENDING call for a day in ONE statement. The status = 'PENDING'
// guard makes it idempotent: running it twice settles nothing the second time.
// Returns the rows that were settled by THIS run (used to notify each user once).
const settleDay = async (tradeDate, closePrice) => {
  const { rows } = await pool.query(
    `
    UPDATE nifty_predictions
    SET close_price = $2,
        resolved_at = NOW(),
        status = CASE
          WHEN $2 = baseline_price THEN 'VOID'
          WHEN direction = 'UP'   AND $2 > baseline_price THEN 'WON'
          WHEN direction = 'DOWN' AND $2 < baseline_price THEN 'WON'
          ELSE 'LOST'
        END
    WHERE trade_date = $1 AND status = 'PENDING'
    RETURNING user_id, direction, baseline_price, close_price, status
    `,
    [tradeDate, closePrice],
  );
  return rows;
};

// No trustworthy close could be captured for a day: void its calls rather than
// judge them against a wrong number. Nobody wins or loses.
const voidDay = async (tradeDate) => {
  const { rows } = await pool.query(
    `
    UPDATE nifty_predictions
    SET status = 'VOID', resolved_at = NOW()
    WHERE trade_date = $1 AND status = 'PENDING'
    RETURNING user_id
    `,
    [tradeDate],
  );
  return rows;
};

module.exports = {
  getPredictionForDay,
  getRecentPredictions,
  insertPrediction,
  saveDailyClose,
  getDailyClose,
  getPendingDays,
  settleDay,
  voidDay,
};
