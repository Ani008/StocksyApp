// services/codeDelivery.js
//
// Issue a one-time code for a user and e-mail it.
//
// The e-mail is sent in the background (not awaited). Sending takes seconds,
// and only existing accounts get one - if the request waited for it, response
// time alone would tell a stranger which e-mails are registered.

const otp = require("./otpService");
const logger = require("../utils/logger");
const sendForgotPasswordEmail = require("../utils/sendForgotPasswordEmail");
const sendVerificationEmail = require("../utils/sendVerificationEmail");

const SENDERS = {
  [otp.PURPOSES.PASSWORD_RESET]: sendForgotPasswordEmail,
  [otp.PURPOSES.EMAIL_VERIFY]: sendVerificationEmail,
};

/**
 * user: { id, email, full_name }
 * Returns true when a code was issued and queued, false when this account is
 * being throttled (cooldown / hourly cap). Callers answer the same either way.
 */
async function sendCode(user, purpose) {
  const code = await otp.issueCode(user.id, purpose);
  if (!code) return false;

  SENDERS[purpose]({ email: user.email, name: user.full_name, otp: code }).catch((err) =>
    logger.error(`[CODE EMAIL] ${purpose} failed: ${err.message}`),
  );
  return true;
}

module.exports = { sendCode };
