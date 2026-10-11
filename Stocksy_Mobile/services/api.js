import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {API_BASE_URL, API_TIMEOUT} from "../src/config/env";
import { showToast, triggerSessionExpired } from './uiBridge';

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

// ─── Request interceptor — attach JWT token from AsyncStorage ─────────────────
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        debugLog(`[API ➡️ ] ${config.method?.toUpperCase()} ${config.baseURL}${config.url} — token attached ✅`);
      } else {
        debugLog(`[API ➡️ ] ${config.method?.toUpperCase()} ${config.baseURL}${config.url} — no token`);
      }
    } catch (e) {
      debugLog('[API ➡️ ] Could not read token from AsyncStorage:', e.message);
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
  (error) => {
    if (error.response) {
      debugLog(`[API ❌] ${error.response.status} ${error.config?.url}`);
      debugLog('[API ❌] Response data:', JSON.stringify(error.response.data));

      const { message, code, severity } = error.response.data || {};

      if (code === 'SESSION_EXPIRED') {
        // Full-screen re-auth, not a toast — a toast that disappears
        // while the user is still stuck isn't useful here.
        AsyncStorage.removeItem('token');
        AsyncStorage.removeItem('user');
        triggerSessionExpired();
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
    } else if (error.request) {
      debugLog('[API 🔴] No response received — check IP/server');
      debugLog('[API 🔴] URL attempted:', error.config?.baseURL + error.config?.url);
      showToast('No connection to the server. Check your network.', 'error');
    } else {
      debugLog('[API 🔴] Axios config error:', error.message);
      showToast('Something went wrong. Please try again.', 'error');
    }
    return Promise.reject(error);
  }
);

export default api;