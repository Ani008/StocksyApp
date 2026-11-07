const { pool } = require("../config/postgres");

// Every read/write is scoped by user_id: one student can never see or change
// another student's entry.

const toEntry = (row) =>
  row
    ? { division: row.division, joinedAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at }
    : null;

// This user's entry in a competition, or null.
const findEntry = async (userId, competitionKey) => {
  const { rows } = await pool.query(
    `SELECT division, created_at
       FROM competition_entries
      WHERE user_id = $1 AND competition_key = $2`,
    [userId, competitionKey],
  );
  return toEntry(rows[0]);
};

// Create the entry. Returns it, or null when this user already has one (a double
// tap, a second device, two requests racing): the UNIQUE key decides, so there
// can never be two.
const insertEntry = async (userId, competitionKey, division) => {
  const { rows } = await pool.query(
    `INSERT INTO competition_entries (user_id, competition_key, division)
     VALUES ($1, $2, $3)
     ON CONFLICT (competition_key, user_id) DO NOTHING
     RETURNING division, created_at`,
    [userId, competitionKey, division],
  );
  return toEntry(rows[0]);
};

module.exports = { findEntry, insertEntry };
