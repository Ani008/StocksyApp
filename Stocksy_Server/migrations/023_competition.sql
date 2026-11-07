-- =============================================================
-- VU TRADING COMPETITION: feature switches + entries
-- =============================================================
--
-- 1. app_features  — remote on/off switches (and a few dated settings) that the
--    server hands to the app, so the competition can be turned on or off with one
--    SQL statement: no app release, no rebuild, no server restart. The server
--    caches the table for a few seconds (see services/featureService.js).
--
--    Three independent switches (all OFF until you turn them on):
--      competition_visible            the card/page appear in the app
--      competition_registration_open  students may join (and pick a division)
--      competition_enabled            competition TRADING is allowed (a later stage)
--
--    Registration needs its own switch because students join in the workshops,
--    BEFORE the contest starts, while trading must still be locked.
--
--    Settings use the `value` column. `competition_starts_at` is when the contest
--    starts: the countdown in the app counts down to it, and registration closes
--    at that moment (no late joiners). Change it with an UPDATE, e.g. to extend.
--
-- 2. competition_entries — who joined which competition and in which division.
--    One row per student per competition: the UNIQUE key makes the database
--    itself reject a double tap or a second device.
--
-- Run once against the Stocksy Postgres database, after 022_username_avatar.sql.
-- Safe to re-run: it never overwrites switches you have already changed.

CREATE TABLE IF NOT EXISTS app_features (
  feature_key  VARCHAR(100) PRIMARY KEY,
  enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
  value        TEXT,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO app_features (feature_key, enabled, value) VALUES
  ('competition_visible',           FALSE, NULL),
  ('competition_registration_open', FALSE, NULL),
  ('competition_enabled',           FALSE, NULL),
  ('competition_starts_at',         TRUE,  '2026-11-18T12:00:00+05:30')
ON CONFLICT (feature_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS competition_entries (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  competition_key  VARCHAR(50)  NOT NULL,
  division         VARCHAR(1)   NOT NULL CHECK (division ~ '^[A-Z]$'),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (competition_key, user_id)
);

-- Division headcounts and the division leaderboard read this.
CREATE INDEX IF NOT EXISTS idx_competition_entries_division
  ON competition_entries (competition_key, division);
