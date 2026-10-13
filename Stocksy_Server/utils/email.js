// utils/email.js
//
// One place that decides what "the same email" means. Emails are stored and
// looked up trimmed and lower-cased, so A@x.com and a@x.com are one account.
// (users has a unique index on lower(email) as the backstop.)

const MAX_EMAIL_LENGTH = 150; // users.email is VARCHAR(150)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, lower-cased email, or null when it is not a usable address. */
function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) return null;
  return email;
}

module.exports = { normalizeEmail, MAX_EMAIL_LENGTH };
