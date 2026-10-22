import axios from 'axios';
import {API_BASE_URL, API_TIMEOUT} from "../src/config/env";
import { showToast, triggerSessionExpired } from './uiBridge';
import * as tokenStore from './tokenStore';
import { AUTH_HEADERS, refreshSession } from './sessionManager';

// SECURITY: request/response logging is dev-only. In a production web build
// (__DEV__ === false) nothing is printed, so request URLs, server responses
// and error payloads never show up in the browser console of real users.
const debugLog = (...args) => {
  if (__DEV__) console.log(...args);
};

debugLog('[api.js] API_BASE_URL:', API_BASE_URL);

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  // The web build needs the browser to send/accept the httpOnly refresh
  // cookie on calls to the API; native has no cookie jar to use.
  withCredentials: tokenStore.IS_WEB,
  headers: {
    "Content-Type": "application/json",
    ...AUTH_HEADERS,
  },
});

// The auth endpoints manage the session themselves — never "refresh and retry"
// a failed login or a failed refresh.
const isAuthEndpoint = (url = '') =>
  /^\/?auth\/(login|signup|refresh|logout|google|verify-email|resend-verification)/.test(url);

// ─── Request interceptor — attach the access token ────────────────────────────
// (in memory on web, AsyncStorage on native: see tokenStore.js)
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await tokenStore.getAccessToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        debugLog(`[API ➡️ ] ${config.method?.toUpperCase()} ${config.baseURL}${config.url} — token attached ✅`);
      } else {
        debugLog(`[API ➡️ ] ${config.method?.toUpperCase()} ${config.baseURL}${config.url} — no token`);
      }
    } catch (e) {
      debugLog('[API ➡️ ] Could not read the access token:', e.message);
    }
    return config;
  },
  (error) => {
    debugLog('[API ➡️ ] Request setup error:', error.message);
    return Promise.reject(error);
  }
);

// ─── Response interceptor ─────────────────────────────────────────────────────
api.interceptors.response.use(
  (response) => {
    debugLog(`[API ✅] ${response.status} ${response.config.url}`);
    return response;
  },
  async (error) => {
    // Background calls (e.g. the daily streak check-in) pass { silent: true }:
    // a failure there must not pop an error toast every time the app opens.
    // Session handling below is unaffected.
    const quiet = !!error.config?.silent;

    if (error.response) {
      debugLog(`[API ❌] ${error.response.status} ${error.config?.url}`);

      const { message, code, severity } = error.response.data || {};
      const original = error.config;

      // Access tokens are short-lived: on SESSION_EXPIRED first try to swap the
      // refresh token for a new one and replay the request ONCE. Only if that
      // is refused does the person see the full-screen re-login.
      if (
        code === 'SESSION_EXPIRED' &&
        original &&
        !original._retried &&
        !isAuthEndpoint(original.url)
      ) {
        original._retried = true;

        const sentToken = String(original.headers?.Authorization || '').replace('Bearer ', '');
        const currentToken = await tokenStore.getAccessToken();

        try {
          // Another request may already have refreshed while this one was in
          // flight: then just replay with the newer token.
          const session = currentToken && currentToken !== sentToken
            ? { token: currentToken }
            : await refreshSession();

          if (session) {
            original.headers.Authorization = `Bearer ${session.token}`;
            return api(original);
          }
          // refused: fall through to the re-login screen below
        } catch (refreshError) {
          // Could not reach the server to refresh: keep the session.
          if (!quiet) showToast('No connection to the server. Check your network.', 'error');
          return Promise.reject(error);
        }
      }

      if (code === 'SESSION_EXPIRED') {
        // Full-screen re-auth, not a toast — a toast that disappears
        // while the user is still stuck isn't useful here.
        await tokenStore.clearSession();
        triggerSessionExpired();
      } else if (code === 'MARKET_CLOSED') {
        // Intentionally no toast here. This has a rich payload
        // ({ reason, nextOpen }) that the calling screen (e.g.
        // BuyOrderScreen) uses to render a proper message box with
        // the exact next-open date/time — a one-line toast would
        // throw that detail away.
      } else if (!quiet) {
        showToast(
          message || 'Something went wrong. Please try again.',
          severity || 'error'
        );
      }
    } else if (error.request) {
      debugLog('[API 🔴] No response received — check IP/server');
      debugLog('[API 🔴] URL attempted:', error.config?.baseURL + error.config?.url);
      if (!quiet) showToast('No connection to the server. Check your network.', 'error');
    } else {
      debugLog('[API 🔴] Axios config error:', error.message);
      if (!quiet) showToast('Something went wrong. Please try again.', 'error');
    }
    return Promise.reject(error);
  }
);

export default api;