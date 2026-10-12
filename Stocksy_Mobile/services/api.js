import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {API_BASE_URL, API_TIMEOUT} from "../src/config/env";
import { showToast, triggerSessionExpired } from './uiBridge';
import {
  IS_WEB,
  TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  USER_KEY,
  getCsrfToken,
  setCsrfToken,
} from './sessionState';

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
  headers: {
    "Content-Type": "application/json",
  },
});

// ─── Request interceptor ──────────────────────────────────────────────────────
//   Web:    the browser attaches the HttpOnly session cookie by itself
//           (withCredentials). We add X-Client-Type so the server answers in
//           "cookie mode", and X-CSRF-Token on anything that changes data.
//   Native: Authorization: Bearer <short-lived access token> from AsyncStorage.
api.interceptors.request.use(
  async (config) => {
    try {
      if (IS_WEB) {
        config.withCredentials = true;
        config.headers['X-Client-Type'] = 'web';

        const method = (config.method || 'get').toLowerCase();
        if (method !== 'get' && method !== 'head') {
          // After a reload the in-memory CSRF token is gone; get it back first.
          if (!getCsrfToken() && !config.__noRefresh) await fetchWebSession();
          const csrf = getCsrfToken();
          if (csrf) config.headers['X-CSRF-Token'] = csrf;
        }
      } else {
        const token = await AsyncStorage.getItem(TOKEN_KEY);
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
          debugLog(`[API ➡️ ] ${config.method?.toUpperCase()} ${config.url} — token attached ✅`);
        } else {
          debugLog(`[API ➡️ ] ${config.method?.toUpperCase()} ${config.url} — no token`);
        }
      }
    } catch (e) {
      debugLog('[API ➡️ ] Could not prepare auth:', e.message);
    }
    return config;
  },
  (error) => {
    debugLog('[API ➡️ ] Request setup error:', error.message);
    return Promise.reject(error);
  }
);

// ─── Session helpers ──────────────────────────────────────────────────────────

// "Who am I?" using the cookie. Fills in the CSRF token. Never toasts and never
// triggers the session-expired screen (a visitor who is simply logged out is
// not an error).
export async function fetchWebSession() {
  try {
    const res = await api.get('/auth/session', { __silent: true, __noRefresh: true });
    setCsrfToken(res.data?.csrfToken);
    return res.data;
  } catch (e) {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Swap the refresh token for a new access session. Resolves to:
//   'ok'      new session is in place (cookies set / tokens stored)
//   'expired' the server says this session is over → the user must log in
//   'error'   couldn't reach the server → do NOT log the user out
let refreshInFlight = null;

async function doRefresh(attempt = 0) {
  try {
    if (IS_WEB) {
      const res = await api.post('/auth/refresh', {}, { __silent: true, __noRefresh: true });
      setCsrfToken(res.data?.csrfToken);
      if (res.data?.user) {
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(res.data.user));
      }
      return 'ok';
    }

    const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return 'expired';
    const res = await api.post('/auth/refresh', { refreshToken }, { __silent: true, __noRefresh: true });
    await AsyncStorage.setItem(TOKEN_KEY, res.data.token);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, res.data.refreshToken);
    return 'ok';
  } catch (err) {
    const code = err?.response?.data?.code;
    // Another browser tab refreshed at the same moment; its new cookie is
    // already in the browser, so just try again once.
    if (code === 'REFRESH_RETRY' && attempt < 2) {
      await sleep(300);
      return doRefresh(attempt + 1);
    }
    if (err?.response && (err.response.status === 401 || err.response.status === 403)) return 'expired';
    return 'error';
  }
}

export function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function clearLocalSession() {
  setCsrfToken(null);
  await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY]);
}

// ─── Response interceptor ─────────────────────────────────────────────────────
api.interceptors.response.use(
  (response) => {
    debugLog(`[API ✅] ${response.status} ${response.config.url}`);
    return response;
  },
  async (error) => {
    const cfg = error.config || {};

    if (error.response) {
      debugLog(`[API ❌] ${error.response.status} ${cfg.url}`);

      const { message, code, severity } = error.response.data || {};

      if (code === 'SESSION_EXPIRED') {
        // The access token is short-lived now, so this usually just means
        // "time to refresh". Refresh once and replay the request; only if the
        // refresh itself fails is the user really logged out.
        if (!cfg.__retried && !cfg.__noRefresh) {
          const result = await refreshSession();
          if (result === 'ok') {
            cfg.__retried = true;
            return api(cfg);
          }
          if (result === 'error') {
            // Offline / server down: keep the session, just fail this request.
            if (!cfg.__silent) showToast('No connection to the server. Check your network.', 'error');
            return Promise.reject(error);
          }
        }

        if (cfg.__silent) return Promise.reject(error);

        // Full-screen re-auth, not a toast — a toast that disappears
        // while the user is still stuck isn't useful here.
        await clearLocalSession();
        triggerSessionExpired();
      } else if (cfg.__silent) {
        // caller handles it
      } else if (code === 'MARKET_CLOSED') {
        // Intentionally no toast here. This has a rich payload
        // ({ reason, nextOpen }) that the calling screen (e.g.
        // BuyOrderScreen) uses to render a proper message box with
        // the exact next-open date/time — a one-line toast would
        // throw that detail away.
      } else {
        showToast(
          message || 'Something went wrong. Please try again.',
          severity || 'error'
        );
      }
    } else if (cfg.__silent) {
      // caller handles it
    } else if (error.request) {
      debugLog('[API 🔴] No response received — check IP/server');
      showToast('No connection to the server. Check your network.', 'error');
    } else {
      debugLog('[API 🔴] Axios config error:', error.message);
      showToast('Something went wrong. Please try again.', 'error');
    }
    return Promise.reject(error);
  }
);

export default api;