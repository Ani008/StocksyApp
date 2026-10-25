const { pool } = require("../config/postgres");

// Every read/write of an answer is scoped by user_id, so one user can never see
// or change another user's answers even by guessing ids.

// ── The day ──────────────────────────────────────────────────────────────────

const getDay = async (playDate) => {
  const { rows } = await pool.query(
    `SELECT payload FROM stock_of_the_day WHERE play_date = $1`,
    [playDate],
  );
  return rows[0] ? rows[0].payload : null;
};

// Store the day, unless another request got there first. Always returns the
// day that is actually stored (ours, or the one that won the race), so
// everyone ends up with the same rounds.
const insertDay = async (playDate, payload) => {
  await pool.query(
    `
    INSERT INTO stock_of_the_day (play_date, payload)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (play_date) DO NOTHING
    `,
    [playDate, JSON.stringify(payload)],
  );
  return getDay(playDate);
};

// ── Answers ──────────────────────────────────────────────────────────────────

const getAnswers = async (userId, playDate) => {
  const { rows } = await pool.query(
    `
    SELECT round_index, picked_key
    FROM stock_of_the_day_answers
    WHERE user_id = $1 AND play_date = $2
    ORDER BY round_index
    `,
    [userId, playDate],
  );
  return rows.map((r) => ({ roundIndex: r.round_index, pickedKey: r.picked_key }));
};

// Lock in one answer. Returns { created }:
//   created = true   this answer just locked in
//   created = false  the round was already answered (a double tap or a second
//                    device); the original answer is kept, never overwritten
const insertAnswer = async ({ userId, playDate, roundIndex, pickedKey }) => {
  const { rowCount } = await pool.query(
    `
    INSERT INTO stock_of_the_day_answers (user_id, play_date, round_index, picked_key)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, play_date, round_index) DO NOTHING
    `,
    [userId, playDate, roundIndex, pickedKey],
  );
  return { created: rowCount === 1 };
};

module.exports = { getDay, insertDay, getAnswers, insertAnswer };
