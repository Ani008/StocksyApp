import api from "./api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import marketSocket from "./marketSocket";
import * as tokenStore from "./tokenStore";
import { restoreSession } from "./sessionManager";
import { disablePush, syncExistingSubscription } from "../src/pwa/push";

// ─── Session helpers ──────────────────────────────────────────────────────────
// Where the session actually lives (memory on web, secure storage on native)
// is tokenStore.js's business; sessionManager.js refreshes it.

export const getStoredToken = () => tokenStore.getAccessToken();

/** App start: is there a signed-in session? (Web asks the server via the cookie.) */
export const restoreStoredSession = restoreSession;

// The shared market socket registers itself with the server as whoever was
// logged in when it connected. Tell it whenever that changes so order
// notifications can never go to the previous user's session.
// `data` is the login/signup response: { id, token, expiresIn, refreshToken? }.
const storeSession = async (data) => {
  await tokenStore.saveSession(data);
  marketSocket.resetIdentity();
  // Web push: if this browser already has a subscription, hand it to whoever
  // just signed in (no-op on native and when notifications are off).
  syncExistingSubscription();
};

const clearToken = async () => {
  await tokenStore.clearSession(); // also removes the stored "user" entry
  marketSocket.resetIdentity();
};

// Google login/signup hit a separate backend route (/auth/google) and
// were, until now, persisting their session with SecureStore instead of
// AsyncStorage — a different storage backend than the one getStoredToken()
// (and api.js's request interceptor) actually reads from. That meant a
// Google session looked successful for one screen, then silently failed
// auth on the very next API call / app relaunch. This helper makes Google
// auth persist through the exact same path as email/password auth.
export const persistGoogleSession = async (data) => {
  await storeSession(data);

  await AsyncStorage.setItem(
    "user",
    JSON.stringify({
      id: data.id,
      username: data.username,
      fullName: data.fullName,
      email: data.email,
      avatar: data.avatar,
    }),
  );
};

// ─── Auth calls ───────────────────────────────────────────────────────────────

const signup = async ({ fullName, email, password }) => {
  const response = await api.post("/auth/signup", {
    fullName,
    email,
    password,
  });

  // Mirror login()'s persistence — SignupPage navigates straight into
  // MainTabs after this resolves, so without storing the token/user here
  // the very first screens the person sees would have no auth session.
  await storeSession(response.data);

  await AsyncStorage.setItem(
    "user",
    JSON.stringify({
      id: response.data.id,
      username: response.data.username,
      fullName: response.data.fullName,
      email: response.data.email,
    }),
  );

  return response.data;
};

export const login = async (email, password) => {
  const response = await api.post("/auth/login", { email, password });

  await storeSession(response.data);

  await AsyncStorage.setItem(
    "user",
    JSON.stringify({
      id: response.data.id,
      username: response.data.username,
      fullName: response.data.fullName,
      email: response.data.email,
    }),
  );

  return response.data;
};

export const logout = async () => {
  try {
    // While the token is still valid: stop pushing this person's alerts to
    // this browser. Web only, best effort, never blocks logging out.
    await disablePush().catch(() => {});
    // Ends the session on the SERVER (revokes it, clears the web cookie, drops
    // live sockets). Native sends its refresh token; web's rides in the cookie.
    const refreshToken = await tokenStore.getRefreshToken();
    const response = await api.post("/auth/logout", refreshToken ? { refreshToken } : {});
    return response.data;
  } finally {
    // Always wipe local state, even if the server could not be reached.
    await clearToken();
  }
};

// password is only required for local (email/password) accounts — the
// backend skips that check for Google accounts. Safe to always pass
// whatever the modal collected; the backend ignores it if not needed.
export const deleteAccount = async (password) => {
  const response = await api.delete("/auth/account", {
    data: password ? { password } : {},
  });

  await clearToken();

  return response.data;
};

// ─── Default export (object) so both import styles work ──────────────────────
// LoginPage.js  → import authService from '...'  → authService.login(...)
// App.js        → import { getStoredToken } from '...'  → getStoredToken()

const authService = {
  signup,
  login,
  logout,
  getStoredToken,
  restoreStoredSession,
  deleteAccount,
  persistGoogleSession,
};
export default authService;
