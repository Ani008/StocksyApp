// services/pendingCredentials.js
//
// Email verification needs the password the person just typed (see
// POST /auth/verify-email on the server: it confirms the mailbox AND makes
// sure the account ends up with the password of whoever owns it).
//
// The signup/login screens hand it to the verification screen through here.
// It lives in memory only: never in navigation params (on the web those can
// end up in the URL / history), never in storage, gone on reload or logout.

let pending = null; // { email, password }

export const setPendingCredentials = (email, password) => {
  pending = { email: String(email || "").trim().toLowerCase(), password };
};

export const getPendingPassword = (email) => {
  const wanted = String(email || "").trim().toLowerCase();
  return pending && pending.email === wanted ? pending.password : null;
};

export const clearPendingCredentials = () => {
  pending = null;
};
