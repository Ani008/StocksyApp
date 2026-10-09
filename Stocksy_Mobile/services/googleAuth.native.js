import { API_BASE_URL, WEB_CLIENT_ID } from "../src/config/env";

// Native (iOS/Android) Google Sign-In.
//
// IMPORTANT: the native module is loaded lazily inside try/catch, NOT with a
// top-level `import`. A top-level import crashes the whole bundle at startup
// ("RNGoogleSignin could not be found" -> "main has not been registered")
// whenever the binary doesn't contain the module, which is always the case in
// Expo Go. With the lazy load, the app boots everywhere and only the Google
// button reports a clear error in Expo Go.
//
// Metro picks this file over googleAuth.js on iOS/Android, and
// googleAuth.web.js on web, so the PWA never touches the native module.

const TAG = "[GoogleAuth]";

let GoogleSignin = null;
let statusCodes = {};
let loadError = null;

try {
  const mod = require("@react-native-google-signin/google-signin");
  GoogleSignin = mod.GoogleSignin;
  statusCodes = mod.statusCodes || {};
} catch (e) {
  loadError = e;
  console.log(`${TAG} native module not available in this build:`, e?.message);
}

let configured = false;

const configureGoogle = () => {
  if (!GoogleSignin) {
    throw new Error(
      "Google Sign-In isn't available in Expo Go. Use email/password here, or run a development build (eas build --profile development).",
    );
  }

  if (!WEB_CLIENT_ID || !WEB_CLIENT_ID.endsWith(".apps.googleusercontent.com")) {
    throw new Error(
      "EXPO_PUBLIC_WEB_CLIENT_ID is missing or invalid. For local runs put it in Stocksy_Mobile/.env, then restart with npx expo start -c. EAS builds read it from eas.json.",
    );
  }

  if (configured) return;

  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID, // must be the *Web application* OAuth client
    offlineAccess: false,
  });

  configured = true;
};

const describeError = (err) => {
  const code = String(err?.code ?? "");
  const msg = err?.message || "Unknown error";

  if (code === String(statusCodes.IN_PROGRESS)) {
    return "A Google sign-in is already in progress.";
  }
  if (code === String(statusCodes.PLAY_SERVICES_NOT_AVAILABLE)) {
    return "Google Play Services is missing or outdated on this device.";
  }
  if (code === "10" || /DEVELOPER_ERROR/i.test(msg)) {
    return "DEVELOPER_ERROR: this build's package name / signing SHA-1 isn't registered in Google Cloud.";
  }
  return `${msg}${code ? ` (code ${code})` : ""}`;
};

// Returns the Stocksy session payload ({ token, user, ... }) from the server,
// or null if the user cancelled. LoginPage/SignupPage pass it straight to
// authService.persistGoogleSession().
export const signInWithGoogle = async () => {
  configureGoogle();

  let idToken;

  try {
    if (GoogleSignin.hasPlayServices) {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }

    const response = await GoogleSignin.signIn();

    // v13+ resolves with { type, data } instead of throwing on cancel
    if (response?.type === "cancelled") return null;

    idToken = response?.data?.idToken ?? response?.idToken;
  } catch (err) {
    if (String(err?.code) === String(statusCodes.SIGN_IN_CANCELLED)) return null;
    console.log(`${TAG} FAILED code=${err?.code} message=${err?.message}`);
    throw new Error(describeError(err));
  }

  if (!idToken) {
    throw new Error(
      "Google signed you in but returned no ID token. Check that webClientId is a Web-type OAuth client.",
    );
  }

  const res = await fetch(`${API_BASE_URL}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || "Google authentication failed.");
  }

  return data;
};

// Call from logout so the next Google login shows the account picker again.
export const signOutFromGoogle = async () => {
  if (!GoogleSignin) return;
  try {
    await GoogleSignin.signOut();
  } catch (e) {
    console.log(`${TAG} signOut failed:`, e?.message);
  }
};
