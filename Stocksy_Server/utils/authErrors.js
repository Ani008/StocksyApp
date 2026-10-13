// utils/authErrors.js
// The { message, code, severity } error contract used across the API
// (see utils/errors.js), as a one-liner for the auth layer.

function sendError(res, status, message, code, severity = "error") {
  return res.status(status).json({ message, code, severity });
}

const sessionExpired = (res) =>
  sendError(
    res,
    401,
    "Your session has expired. Please log in again.",
    "SESSION_EXPIRED",
  );

module.exports = { sendError, sessionExpired };
