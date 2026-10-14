-- =============================================================
-- WATCHLISTS
-- =============================================================
--
-- A user can keep several named watchlists (e.g. "Banking", "Long term"),
-- each holding any number of instruments.
--
-- Only the instrument_key is stored per item. Symbol / name / sector are
-- looked up from config/instruments.js when the list is read, so a rename
-- in that file shows up everywhere without a data migration.
--
-- Run once against the Stocksy Postgres database.
-- (gen_random_uuid() is already used by 001_create_users.sql.)

CREATE TABLE IF NOT EXISTS watchlists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(30) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One list per name per user, ignoring case ("Banking" and "banking" clash).
CREATE UNIQUE INDEX IF NOT EXISTS uq_watchlists_user_name
  ON watchlists (user_id, LOWER(name));

CREATE TABLE IF NOT EXISTS watchlist_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id    UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  instrument_key  VARCHAR(100) NOT NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The same stock can't be added to the same list twice.
  UNIQUE (watchlist_id, instrument_key)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_watchlist
  ON watchlist_items (watchlist_id);
