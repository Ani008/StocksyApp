// services/sessionState.js
//
// Where the login session lives, per platform:
//
//   WEB (PWA)  The session is two HttpOnly cookies set by the server. JavaScript
//              cannot read them — so there is no token in localStorage for an
//              XSS bug to steal. The only thing kept here is the CSRF token,
//              IN MEMORY (re-fetched from GET /auth/session after a reload).
//
//   NATIVE     Unchanged idea: a bearer access token (now short-lived, ~15 min)
//              plus a refresh token in AsyncStorage.
//
// Kept in its own file so api.js and authService.js can both import it
// without importing each other.

import { Platform } from "react-native";

export const IS_WEB = Platform.OS === "web";

export const TOKEN_KEY = "token";               // native access token
export const REFRESH_TOKEN_KEY = "refreshToken"; // native refresh token
export const USER_KEY = "user";                 // public profile only (no secrets)

let csrfToken = null;
export const getCsrfToken = () => csrfToken;
export const setCsrfToken = (t) => {
  csrfToken = t || null;
};
