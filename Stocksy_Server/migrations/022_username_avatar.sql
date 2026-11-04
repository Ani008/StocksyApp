-- =============================================================
-- USERNAMES + AVATARS
-- =============================================================
--
-- Until now users.username was just the first word of the person's name
-- ("Rahul") — not unique, and shown in the app as "Hi, Rahul". That column
-- keeps working exactly as before. A real, unique, user-chosen username is
-- layered on top of it:
--
--   username_set     TRUE once the person has CHOSEN their username. Until then
--                    users.username is still the old first-name value and is not
--                    unique. Every existing account starts FALSE, so each one is
--                    asked to choose a username once.
--   signup_username  A username typed on the signup screen of an account whose
--                    email is not confirmed yet. It reserves nothing. It becomes
--                    the real username only when the email is confirmed (see
--                    controllers/auth.js verifyEmail), so nobody can hoard
--                    usernames with throwaway, never-confirmed signups.
--   avatar_id        The avatar picked from the catalog in config/avatars.js
--                    (e.g. "female_3"). NULL = none picked yet. users.avatar is
--                    left as it is: it holds the Google profile photo URL.
--
-- Run once against the Stocksy Postgres database, after 021_follows.sql.
-- Safe to re-run.

ALTER TABLE users ADD COLUMN IF NOT EXISTS username_set     BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_username  VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id        VARCHAR(30);

-- A chosen username is unique, ignoring case. The index only covers chosen
-- usernames, so the existing duplicate first-name values ("Rahul" x3) don't
-- conflict and this runs cleanly on a live table.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username
  ON users (LOWER(username))
  WHERE username_set;

-- Only a confirmed account can own a username. The app already guarantees
-- this; the constraint makes it impossible to break by accident later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_username_set_needs_verified_email'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_username_set_needs_verified_email
      CHECK (NOT username_set OR email_verified);
  END IF;
END $$;
