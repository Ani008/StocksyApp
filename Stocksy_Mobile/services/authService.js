import api, { fetchWebSession, refreshSession, clearLocalSession } from "./api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import marketSocket from "./marketSocket";
import {
  IS_WEB,
  TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  USER_KEY,
  setCsrfToken,
} from "./sessionState";

// ─── Session helpers ──────────────────────────────────────────────────────────
//
// WEB:    the server keeps the session in HttpOnly cookies, so there is no token
//         here at all — only the public profile ("user") and an in-memory CSRF
//         token.
// NATIVE: short-lived access token + refresh token in AsyncStorage.

// Is someone logged in? Used once at app start.
export const hasSession = async () => {
  try {
    if (!IS_WEB) {
      return !!(await AsyncStorage.getItem(TOKEN_KEY));
    }

    // Ask the server whether the cookie session is alive.
    let session = await fetchWebSession();
    if (!session) {
      // Access cookie missing/expired → try the refresh cookie once.
      const result = await refreshSession();
      if (result === "ok") session = await fetchWebSession();
      else if (result === "error") {
        // Offline (e.g. the installed PWA opened with no network): trust the
        // remembered profile so the cached app shell still opens.
        return !!(await AsyncStorage.getItem(USER_KEY));
      }
    }

    if (session?.user) {
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(session.user));
      return true;
    }
    await clearLocalSession();
    return false;
  } catch {
    return false;
  }
};

// Kept for existing imports. On web this is not a token any more.
export const getStoredToken = async () => ((await hasSession()) ? "session" : null);

const profileOf = (d) => ({
  id: d.id,
  username: d.username,
  fullName: d.fullName,
  email: d.email,
  avatar: d.avatar,
});

// Persist a successful login/signup response, whichever platform it came from.
// The user is written FIRST: the market socket reads it to decide who is
// logged in, then asks for a ticket.
const storeSession = async (data) => {
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(profileOf(data)));

  if (IS_WEB) {
    setCsrfToken(data.csrfToken);
  } else {
    await AsyncStorage.setItem(TOKEN_KEY, data.token);
    if (data.refreshToken) await AsyncStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
  }

  marketSocket.resetIdentity();
};

// Google login/signup hit a separate backend route (/auth/google) and
// were, until now, persisting their session with SecureStore instead of
// AsyncStorage — a different storage backend than the one the request
// interceptor actually reads from. This helper makes Google auth persist
// through the exact same path as email/password auth.
export const persistGoogleSession = async (data) => {
  await storeSession(data);
};

// ─── Auth calls ───────────────────────────────────────────────────────────────

const signup = async ({ fullName, email, password }) => {
  const response = await api.post("/auth/signup", {
    fullName,
    email,
    password,
  });

  // SignupPage navigates straight into MainTabs after this resolves, so the
  // session must be in place before it does.
  await storeSession(response.data);

  return response.data;
};

export const login = async (email, password) => {
  const response = await api.post("/auth/login", { email, password });

  await storeSession(response.data);

  return response.data;
};

// Revokes the session on the server (so a copied token/cookie stops working
// immediately), then clears this device.
export const logout = async () => {
  let serverError = null;
  try {
    // (never `null`: axios would send the literal JSON `null`, which the server's JSON parser rejects)
    const body = IS_WEB
      ? {}
      : { refreshToken: await AsyncStorage.getItem(REFRESH_TOKEN_KEY) };
    const response = await api.post("/auth/logout", body, { __noRefresh: true, __silent: true });
    return response.data;
  } catch (err) {
    serverError = err;
    // On the web the cookie lives in the browser; if we could not reach the
    // server to clear it, pretending to be logged out would be a lie.
    if (IS_WEB && !err?.response) throw err;
  } finally {
    if (!(IS_WEB && serverError && !serverError.response)) {
      await clearLocalSession();
      marketSocket.resetIdentity();
    }
  }
};

// Sign out of every device.
export const logoutEverywhere = async () => {
  const response = await api.post("/auth/logout-all");
  await clearLocalSession();
  marketSocket.resetIdentity();
  return response.data;
};

// password is only required for local (email/password) accounts — the
// backend skips that check for Google accounts. Safe to always pass
// whatever the modal collected; the backend ignores it if not needed.
export const deleteAccount = async (password) => {
  const response = await api.delete("/auth/account", {
    data: password ? { password } : {},
  });

  await clearLocalSession();
  marketSocket.resetIdentity();

  return response.data;
};

// ─── Default export (object) so both import styles work ──────────────────────
// LoginPage.js  → import authService from '...'  → authService.login(...)
// App.js        → import { hasSession } from '...'  → hasSession()

const authService = {
  signup,
  login,
  logout,
  logoutEverywhere,
  getStoredToken,
  hasSession,
  deleteAccount,
  persistGoogleSession,
};
export default authService;
