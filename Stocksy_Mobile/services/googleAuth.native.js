import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { API_BASE_URL, WEB_CLIENT_ID } from "../src/config/env";

let configured = false;

const configureGoogle = () => {
  if (configured) return;

  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
  });

  configured = true;
};

export const signInWithGoogle = async () => {
  configureGoogle();

  await GoogleSignin.hasPlayServices();

  const userInfo = await GoogleSignin.signIn();

  const idToken = userInfo?.data?.idToken;

  if (!idToken) {
    throw new Error("No ID token returned by Google.");
  }

  const response = await fetch(`${API_BASE_URL}/auth/google`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idToken,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Google authentication failed.");
  }

  return data;
};