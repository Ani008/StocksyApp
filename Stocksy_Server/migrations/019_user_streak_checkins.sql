-- =============================================================
-- DAILY STREAK  (open Stocksy on a day = that day counts)
-- =============================================================
--
-- Until now the streak lived only in the app's local storage (AsyncStorage /
-- the browser). That meant it was tied to one install or one web origin: a new
-- deploy on a new domain, a reinstall, a cleared browser or a second device all
-- started again from day 1, even for the same account.
--
-- This table makes the server the source of truth. We store ONE ROW PER DAY the
-- user checked in, and derive the current / longest streak from those days when
-- it is read. Storing the days (not a running counter) means the numbers can
-- never drift out of sync with the calendar, and a retry or a second device can
-- never double-count a day.
--
-- check_in_date is the IST calendar day (a DATE, not a timestamp), the same
-- convention nifty_predictions uses, so there is no timezone ambiguity about
-- which day a check-in belongs to and a phone clock can't move it.
--
-- source:
--   'live'    the user opened the app on that day (recorded by the server)
--   'import'  copied up ONCE from the streak the app had saved on the device,
--             so people don't lose the days they already earned
--
-- Run once against the Stocksy Postgres database.

CREATE TABLE IF NOT EXISTS user_streak_checkins (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_in_date  DATE NOT NULL,
  source         VARCHAR(8) NOT NULL DEFAULT 'live'
                 CHECK (source IN ('live', 'import')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per user per day. Also what makes a double tap, or two devices
  -- opening at once, safe: the second insert simply loses. The primary key's
  -- index serves "this user's days, in date order" too.
  PRIMARY KEY (user_id, check_in_date)
);
