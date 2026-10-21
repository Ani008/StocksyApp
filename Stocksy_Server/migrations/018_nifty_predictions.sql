-- =============================================================
-- DAILY NIFTY PREDICTION  ("slide left = down, slide right = up")
-- =============================================================
--
-- Each user gets ONE call per trading day. It is locked in when made (no
-- taking it back) and settled by a server job right after the 3:30 PM close.
--
-- Why this lives on the server and not on the phone:
--   * the result must be judged against a price the user cannot influence
--   * a streak of CORRECT calls only means something if it can't be edited,
--     and it should survive a reinstall / a new phone
--
-- baseline_price is the Nifty 50 previous close the feed reported at the
-- moment of the call. UP wins if the day closes above it, DOWN if below.
-- A day that closes exactly on the baseline is VOID (nobody wins or loses).
--
-- Run once against the Stocksy Postgres database.
-- (gen_random_uuid() is already used by 001_create_users.sql.)

CREATE TABLE IF NOT EXISTS nifty_predictions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The IST calendar day the call is about (not a timestamp, so there is no
  -- timezone ambiguity about which "day" a call belongs to).
  trade_date      DATE NOT NULL,

  direction       VARCHAR(4) NOT NULL CHECK (direction IN ('UP', 'DOWN')),

  baseline_price  NUMERIC(12, 2) NOT NULL CHECK (baseline_price > 0),

  status          VARCHAR(8) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'WON', 'LOST', 'VOID')),
  close_price     NUMERIC(12, 2),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,

  -- One call per user per day. This is also what makes a double tap, or two
  -- devices submitting at once, safe: the second insert simply loses.
  UNIQUE (user_id, trade_date)
);

-- Streaks read a user's resolved calls newest first.
CREATE INDEX IF NOT EXISTS idx_nifty_predictions_user_date
  ON nifty_predictions (user_id, trade_date DESC);

-- The settle job looks up everything still PENDING for a day.
CREATE INDEX IF NOT EXISTS idx_nifty_predictions_pending
  ON nifty_predictions (trade_date)
  WHERE status = 'PENDING';

-- The close that the settle job captured for a day. Stored once so every
-- user's call is judged against exactly the same number, and so a second run
-- of the job (restart, retry) can never settle a day against a different
-- price than the first run used.
CREATE TABLE IF NOT EXISTS nifty_daily_close (
  trade_date   DATE PRIMARY KEY,
  close_price  NUMERIC(12, 2) NOT NULL CHECK (close_price > 0),
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
