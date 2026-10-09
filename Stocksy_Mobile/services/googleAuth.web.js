import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { API_BASE_URL, WEB_CLIENT_ID } from "../src/config/env";

WebBrowser.maybeCompleteAuthSession();

const discovery = {
  authorizationEndpoint:
    "https://accounts.google.com/o/oauth2/v2/auth",
};

export const signInWithGoogle = async () => {
  if (!WEB_CLIENT_ID) {
    throw new Error("Google Web Client ID is missing.");
  }

  const redirectUri = AuthSession.makeRedirectUri({
    path: "oauth",
  });

  console.log(
    "[GoogleAuth Web] Redirect URI:",
    redirectUri,
  );

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

  const result = await request.promptAsync(discovery);

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
      headers: {
        "Content-Type": "application/json",
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