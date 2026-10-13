// services/sessionManager.js
//
// Refreshing the login session (security review items 1 and 2).
//
// Access tokens now last ~15 minutes. When one runs out, the refresh token is
// swapped for a new pair via POST /auth/refresh:
//   web    : the httpOnly cookie is sent automatically (withCredentials)
//   native : the refresh token from secure storage is sent in the body
//
// This file deliberately uses plain axios, not services/api.js, so a refresh
// call can never trigger api.js's own 401 handling (and so api.js can import
// this file without a cycle).

import axios from "axios";
import { API_BASE_URL, API_TIMEOUT } from "../src/config/env";
import * as store from "./tokenStore";

export const AUTH_MODE = store.IS_WEB ? "cookie" : "body";
export const AUTH_HEADERS = { "X-Auth-Mode": AUTH_MODE };

// Ask for a new token this long before the old one dies. It must exceed the
// server's 60 s "REAUTH" lead (services/websocketService.js).
const REFRESH_SKEW_MS = 90 * 1000;

let inflight = null;

/**
 * Swap the refresh token for a new session.
 *   resolves with the new session data -> success
 *   resolves with null                 -> the server REFUSED it: signed out
 *   rejects                            -> could not reach the server (offline):
 *                                         the session is kept, try again later
 * Concurrent callers share one request (the refresh token is single-use).
 */
export function refreshSession() {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      let body = {};
      if (!store.isWeb()) {
        const refreshToken = await store.getRefreshToken();
        if (!refreshToken) return null; // nothing to refresh with
        body = { refreshToken };
      }

      const res = await axios.post(`${API_BASE_URL}/auth/refresh`, body, {
        timeout: API_TIMEOUT,
        headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        withCredentials: store.isWeb(),
      });

      await store.saveSession(res.data);
      return res.data;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        await store.clearSession();
        return null;
      }
      throw err; // network error / 5xx: keep the session
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * A usable access token, refreshed first if it is missing, near expiry, or of
 * unknown age (just after a native app restart). Never throws: when offline it
 * returns the token it has, and null when signed out.
 */
export async function getValidAccessToken() {
  const token = await store.getAccessToken();
  const exp = store.getExpiresAt();
  const fresh = token && exp && exp - Date.now() > REFRESH_SKEW_MS;
  if (fresh) return token;

  try {
    const data = await refreshSession();
    return data ? data.token : null;
  } catch {
    return token || null;
  }
}

/**
 * App start. Web: ask the server whether the cookie still holds a live
 * session. Native: signed in if either token is stored (api.js refreshes on
 * demand). Resolves true/false, and false only when really signed out.
 */
export async function restoreSession() {
  if (store.isWeb()) {
    try {
      return !!(await refreshSession());
    } catch {
      // Offline at launch: we cannot tell. Show the app rather than bounce a
      // possibly-signed-in person to the login screen; API calls will sort it
      // out once the connection is back.
      return true;
    }
  }
  return !!((await store.getAccessToken()) || (await store.getRefreshToken()));
}
