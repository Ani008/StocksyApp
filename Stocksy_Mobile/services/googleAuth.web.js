import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { API_BASE_URL, WEB_CLIENT_ID } from "../src/config/env";
import { AUTH_HEADERS } from "./sessionManager";

WebBrowser.maybeCompleteAuthSession();

const discovery = {
  authorizationEndpoint:
    "https://accounts.google.com/o/oauth2/v2/auth",
};

/*
 * WHY THIS FILE PRE-BUILDS THE REQUEST
 * ------------------------------------
 * Google sign-in on web opens a popup with window.open(). iOS Safari only
 * allows that if window.open() runs synchronously inside the tap handler.
 *
 * Previously the tap handler called request.promptAsync(), which first did
 * `await makeAuthUrlAsync()` -> `await PKCE.buildCodeAsync()` (async crypto)
 * and only THEN called window.open(). By that point iOS had dropped the
 * "user tapped" permission and silently blocked the popup. Chrome/Android
 * are lenient about this, which is why only iOS failed.
 *
 * Fix: build the request (PKCE verifier/challenge + auth URL) ahead of time.
 * Then promptAsync() finds the URL already cached and reaches window.open()
 * with no await in between.
 *
 * A request (state + PKCE verifier) is single-use, so a fresh one is
 * prepared after every attempt.
 */

let prepared = null; // { request, redirectUri }
let preparing = null; // in-flight promise

const buildRequest = async () => {
  const redirectUri = AuthSession.makeRedirectUri({
    path: "oauth",
  });

  const request = new AuthSession.AuthRequest({
    clientId: WEB_CLIENT_ID,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    scopes: ["openid", "profile", "email"],
    usePKCE: true,
    extraParams: {
      prompt: "select_account",
    },
  });

  // Computes the PKCE challenge and caches request.url.
  await request.makeAuthUrlAsync(discovery);

  return { request, redirectUri };
};

export const prepareGoogleSignIn = () => {
  if (typeof window === "undefined" || !WEB_CLIENT_ID) {
    return Promise.resolve();
  }

  if (prepared) return Promise.resolve();
  if (preparing) return preparing;

  preparing = buildRequest()
    .then((result) => {
      prepared = result;
    })
    .catch((err) => {
      console.log(
        "[GoogleAuth Web] Could not prepare request:",
        err?.message,
      );
    })
    .finally(() => {
      preparing = null;
    });

  return preparing;
};

// Start preparing as soon as this module loads (LoginPage / SignupPage import
// it), so the request is ready long before the user taps the button.
// Skipped inside the OAuth popup itself, which only needs
// maybeCompleteAuthSession() above.
if (typeof window !== "undefined" && !window.opener) {
  prepareGoogleSignIn();
}

export const signInWithGoogle = async () => {
  if (!WEB_CLIENT_ID) {
    throw new Error("Google Web Client ID is missing.");
  }

  const current = prepared;

  if (!current) {
    // Not ready yet (very fast tap, or preparation failed). Do NOT build it
    // here: awaiting would make iOS block the popup anyway.
    prepareGoogleSignIn();
    throw new Error(
      "Google sign-in is getting ready. Please tap the button again.",
    );
  }

  // Single-use: take it, and prepare the next one.
  prepared = null;

  const { request, redirectUri } = current;

  console.log(
    "[GoogleAuth Web] Redirect URI:",
    redirectUri,
  );

  let result;

  try {
    // request.url is already cached, so this reaches window.open()
    // synchronously, inside the user's tap.
    result = await request.promptAsync(discovery);
  } finally {
    prepareGoogleSignIn();
  }

  // Do NOT log the entire result.
  // It contains the authorization code.
  console.log(
    "[GoogleAuth Web] OAuth result type:",
    result.type,
  );

  if (result.type !== "success") {
    if (
      result.type === "cancel" ||
      result.type === "dismiss"
    ) {
      throw new Error("Google sign-in was cancelled.");
    }

    throw new Error(
      result.params?.error_description ||
        result.params?.error ||
        "Google authentication failed.",
    );
  }

  const code = result.params?.code;

  if (!code) {
    throw new Error(
      "Google did not return an authorization code.",
    );
  }

  if (!request.codeVerifier) {
    throw new Error(
      "Google PKCE code verifier is missing.",
    );
  }

  console.log(
    "[GoogleAuth Web] Authorization code received.",
  );

  const response = await fetch(
    `${API_BASE_URL}/auth/google/web`,
    {
      method: "POST",
      // The server answers with the refresh token as an httpOnly cookie.
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...AUTH_HEADERS,
      },
      body: JSON.stringify({
        code,
        codeVerifier: request.codeVerifier,
        redirectUri,
      }),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message ||
        "Google authentication failed.",
    );
  }

  console.log(
    "[GoogleAuth Web] Stocksy authentication successful.",
  );

  return data;
};
