const { pool } = require("../config/postgres");

// Every read/write is scoped by user_id, so one user can never see or change
// another user's streak even by guessing ids.

// All of a user's check-in days, oldest first, as "YYYY-MM-DD". A person
// checks in at most once a day, so even years of use is a few hundred short
// rows, and the primary key (user_id, check_in_date) serves this in order.
const getDays = async (userId) => {
  const { rows } = await pool.query(
    `
    SELECT check_in_date::text AS day
    FROM user_streak_checkins
    WHERE user_id = $1
    ORDER BY check_in_date ASC
    `,
    [userId],
  );
  return rows.map((r) => r.day);
};

// Record a live check-in for one day. Returns true when THIS call recorded it,
// false when the day was already there (a second device, a double open, a
// retry). The unique key makes that safe even if two requests race.
const recordCheckIn = async (userId, day) => {
  const { rowCount } = await pool.query(
    `
    INSERT INTO user_streak_checkins (user_id, check_in_date, source)
    VALUES ($1, $2, 'live')
    ON CONFLICT (user_id, check_in_date) DO NOTHING
    `,
    [userId, day],
  );
  return rowCount === 1;
};

// Does this user have any check-in dated before `day`? Used to decide whether
// the one-time import of the old on-device streak is still allowed.
const hasDaysBefore = async (userId, day) => {
  const { rows } = await pool.query(
    `
    SELECT EXISTS (
      SELECT 1 FROM user_streak_checkins
      WHERE user_id = $1 AND check_in_date < $2
    ) AS found
    `,
    [userId, day],
  );
  return rows[0].found;
};

// Copy days up from the old on-device streak. Existing days are left alone.
// Returns how many rows were actually added.
const importDays = async (userId, days) => {
  if (days.length === 0) return 0;
  const { rowCount } = await pool.query(
    `
    INSERT INTO user_streak_checkins (user_id, check_in_date, source)
    SELECT $1, d::date, 'import'
    FROM unnest($2::text[]) AS d
    ON CONFLICT (user_id, check_in_date) DO NOTHING
    `,
    [userId, days],
  );
  return rowCount;
};

module.exports = { getDays, recordCheckIn, hasDaysBefore, importDays };
