-- =============================================================
-- STOCK OF THE DAY  (daily head-to-head "who is bigger?" game)
-- =============================================================
--
-- Each IST day has ONE set of rounds (a sector, and up to 5 pairs of stocks,
-- each with a question like "who is bigger in valuation?"). Every user plays
-- the same set and ends with a score such as "3 out of 5".
--
-- Why the day is stored, not recomputed on every request:
--   * the fundamentals feed refreshes during the day; if the set were rebuilt
--     each time, two users (or one user on two devices) could see different
--     rounds, and a half-played day could change under them
--   * the winner and the numbers behind each round are kept here, on the
--     server, and only handed to a user once they have answered every round,
--     so the answers can't be read off the network mid-game
--
-- `payload` is the whole day as built by services/stockOfTheDayLogic.js
-- (sector, rounds, winners, the values compared). It is written once.
--
-- play_date is the IST calendar day (a DATE, not a timestamp), the same
-- convention as nifty_predictions and user_streak_checkins.
--
-- Run once against the Stocksy Postgres database.

CREATE TABLE IF NOT EXISTS stock_of_the_day (
  play_date   DATE PRIMARY KEY,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per answered round. We store only WHICH company the user picked; whether
-- that was right is worked out from the stored day when the result is read, so
-- there is a single source of truth for who won.
CREATE TABLE IF NOT EXISTS stock_of_the_day_answers (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  play_date    DATE NOT NULL REFERENCES stock_of_the_day(play_date) ON DELETE CASCADE,
  round_index  SMALLINT NOT NULL CHECK (round_index BETWEEN 0 AND 9),
  picked_key   VARCHAR(64) NOT NULL,
  answered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One answer per user per round, locked in when given (no taking it back).
  -- Also what makes a double tap, or two devices answering at once, safe: the
  -- second insert simply loses. The primary key's index also serves "this
  -- user's answers for a day".
  PRIMARY KEY (user_id, play_date, round_index)
);
