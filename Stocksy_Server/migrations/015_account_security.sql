-- =============================================================
-- ACCOUNT + PASSWORD SECURITY
-- (security review items 7, 8 and 12)
-- =============================================================
--
--   item 7  : emails are stored lower-cased and unique case-insensitively;
--             users get an email_verified flag; Google sign-in only links to
--             a VERIFIED account.
--   item 8  : password-reset codes move out of users.otp (plain text) into
--             auth_codes, stored as a keyed hash with an attempt counter.
--   item 12 : (no schema change - lockout lives in Redis, policy in code)
--
-- Run once against the Stocksy Postgres database, BEFORE deploying the new
-- server code. 016_drop_plaintext_otp.sql is run AFTER the deploy.
--
-- Needs 014_auth_sessions.sql to have been applied first.
--
-- READ BEFORE RUNNING - two things in here change existing accounts:
--
--   (a) Existing email/password accounts become email_verified = FALSE. On
--       their next login they are asked to enter a code emailed to them once.
--       (To skip that for everyone, run
--           UPDATE users SET email_verified = TRUE WHERE provider = 'local';
--       after this file - but then an email that an attacker pre-registered
--       before this fix stays usable by that attacker.)
--
--   (b) Accounts that Google sign-in had ALREADY silently linked to an
--       email/password account (provider = 'google' but a password is still
--       set) have that password removed and their sessions revoked. Any such
--       password may be an attacker's. The owner is not locked out: Google
--       sign-in keeps working and "Forgot password" sets a new password.
--       This runs only the first time (it is skipped if email_verified
--       already exists), so re-running the file never wipes anything.

-- ── item 7: refuse to merge accounts that differ only by case ────────────────
DO $$
DECLARE
  dupes TEXT;
BEGIN
  SELECT string_agg(e || ' (' || n || ' accounts)', ', ')
    INTO dupes
    FROM (
      SELECT lower(btrim(email)) AS e, count(*) AS n
        FROM users
       GROUP BY 1
      HAVING count(*) > 1
    ) d;

  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'These emails exist more than once when lower-cased. Decide by hand which account to keep (delete or change the email of the others), then re-run: %',
      dupes;
  END IF;
END $$;

UPDATE users
   SET email = lower(btrim(email))
 WHERE email <> lower(btrim(email));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

-- ── item 7: email_verified (+ one-off clean-up of already-linked accounts) ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'users'
       AND column_name = 'email_verified'
  ) THEN
    ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;

    -- Google only hands out tokens for addresses it has verified.
    UPDATE users SET email_verified = TRUE WHERE provider = 'google';

    -- (b) above: silently linked accounts keep a password nobody vouched for.
    UPDATE auth_sessions
       SET revoked_at = NOW(), revoke_reason = 'google_link_cleanup'
     WHERE revoked_at IS NULL
       AND user_id IN (SELECT id FROM users WHERE provider = 'google' AND password <> '');

    UPDATE users SET password = '' WHERE provider = 'google' AND password <> '';
  END IF;
END $$;

-- ── item 8: one-time codes (password reset + email verification) ─────────────
--
-- One row per (user, purpose). The code itself is never stored, only an
-- HMAC of it (see services/otpService.js). Rows are kept after a code is used
-- or burned so the per-hour send cap still applies.
CREATE TABLE IF NOT EXISTS auth_codes (
  user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose            VARCHAR(20) NOT NULL CHECK (purpose IN ('password_reset', 'email_verify')),
  -- NULL once the code has been used.
  code_hash          CHAR(64),
  expires_at         TIMESTAMPTZ NOT NULL,
  -- wrong guesses against the CURRENT code; the code dies at the limit
  attempts           SMALLINT    NOT NULL DEFAULT 0,
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- how many codes were sent in the current hour (caps email spam / re-rolling)
  window_started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sends_in_window    SMALLINT    NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, purpose)
);
