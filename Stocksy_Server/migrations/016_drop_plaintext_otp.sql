-- =============================================================
-- Remove the old plain-text password-reset OTP columns
-- (security review item 8)
-- =============================================================
--
-- Run this AFTER the new server code is deployed. The new code no longer
-- reads or writes users.otp / users.otp_expires_at (codes live, hashed, in
-- auth_codes - see 015_account_security.sql); the previous version of the
-- server still needs these columns, so do not run this before the deploy.
--
-- Safe to run repeatedly.

ALTER TABLE users DROP COLUMN IF EXISTS otp;
ALTER TABLE users DROP COLUMN IF EXISTS otp_expires_at;
