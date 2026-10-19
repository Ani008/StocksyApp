// services/tokenStore.js
//
// Where the login session lives on the client (security review item 1).
//
//   WEB / PWA : the short-lived access token is kept IN MEMORY ONLY. Nothing
//               is written to localStorage, so an XSS bug can no longer lift a
//               long-lived login out of storage. The long-lived part (the
//               refresh token) is an httpOnly cookie the browser holds and page
//               JavaScript cannot read. After a page reload the session is
//               restored by calling /auth/refresh (see sessionManager.js).
//
//   NATIVE    : access token in AsyncStorage as before; the refresh token goes
//               in the OS keychain/keystore through expo-secure-store.
//
// Import this for storage only. Network calls live in sessionManager.js.

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// Function (not just a constant) so tests can switch platforms.
export const isWeb = () => Platform.OS === "web";
export const IS_WEB = isWeb();

const TOKEN_KEY = "token"; // same key older builds used
const USER_ID_KEY = "userId";
const REFRESH_KEY = "stocksy_refresh_token";

// WEB only: a NON-SECRET marker ("1") saying "this browser has signed in and has
// not signed out since". It holds no token and grants no access; it only lets
// app start decide what to show when the server cannot be reached (see
// sessionManager.restoreSession). Without it, a brand-new visitor whose
// session check failed would be dropped on the dashboard with no login.
const SESSION_HINT_KEY = "stocksy_session_hint";

const readHint = () => {
  try {
    return globalThis.localStorage?.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return false; // storage blocked (private mode etc.)
  }
};
const writeHint = (on) => {
  try {
    if (on) globalThis.localStorage?.setItem(SESSION_HINT_KEY, "1");
    else globalThis.localStorage?.removeItem(SESSION_HINT_KEY);
  } catch {
    /* storage blocked: the hint just will not persist */
  }
};

/** Web: has this browser had a signed-in session that was not signed out? */
export const hasSessionHint = () => isWeb() && readHint();

let memToken = null;
let memExpiresAt = 0; // ms epoch; 0 = unknown
let memUserId = null;
let memRefreshToken = null; // native cache of the secure-store value

export const getAccessToken = async () => {
  if (memToken) return memToken;
  if (isWeb()) return null;
  try {
    memToken = (await AsyncStorage.getItem(TOKEN_KEY)) || null;
  } catch {
    memToken = null;
  }
  return memToken;
};

export const getExpiresAt = () => memExpiresAt;

export const getUserId = async () => {
  if (memUserId) return memUserId;
  if (isWeb()) return null;
  try {
    memUserId = (await AsyncStorage.getItem(USER_ID_KEY)) || null;
  } catch {
    memUserId = null;
  }
  return memUserId;
};

export const getRefreshToken = async () => {
  if (isWeb()) return null; // the browser holds it in an httpOnly cookie
  if (memRefreshToken) return memRefreshToken;
  try {
    memRefreshToken = (await SecureStore.getItemAsync(REFRESH_KEY)) || null;
  } catch {
    memRefreshToken = null;
  }
  return memRefreshToken;
};

/**
 * data: the login / refresh response ({ id, token, expiresIn, refreshToken? }).
 * A refreshToken is only present for the native app.
 */
export const saveSession = async (data) => {
  memToken = data.token;
  memExpiresAt = data.expiresIn ? Date.now() + data.expiresIn * 1000 : 0;
  if (data.id) memUserId = String(data.id);

  if (isWeb()) {
    writeHint(true);
    return;
  }

  await AsyncStorage.setItem(TOKEN_KEY, data.token);
  if (data.id) await AsyncStorage.setItem(USER_ID_KEY, String(data.id));
  if (data.refreshToken) {
    memRefreshToken = data.refreshToken;
    await SecureStore.setItemAsync(REFRESH_KEY, data.refreshToken);
  }
};

export const clearSession = async () => {
  memToken = null;
  memExpiresAt = 0;
  memUserId = null;
  memRefreshToken = null;
  writeHint(false);

  // Remove anything an older build left behind, on every platform.
  try {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_ID_KEY, "user"]);
  } catch {
    /* storage unavailable */
  }
  if (!isWeb()) {
    try {
      await SecureStore.deleteItemAsync(REFRESH_KEY);
    } catch {
      /* nothing stored */
    }
  }
};
