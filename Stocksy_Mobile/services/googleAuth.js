import Constants from "expo-constants";
import { WEB_CLIENT_ID } from "../src/config/env";

// Single place for all native Google Sign-In logic. LoginPage and SignupPage
// both call signInWithGoogle() and get back either an ID token, null (user
// cancelled) or a thrown Error whose message says exactly which step failed.
//
// Every step logs with the [GoogleAuth] prefix, so in `adb logcat` / Metro you
// can filter on it and see where the flow stops:
//   [GoogleAuth] 1/4 config ...
//   [GoogleAuth] 2/4 play services ...
//   [GoogleAuth] 3/4 account picker ...
//   [GoogleAuth] 4/4 token ...

const TAG = "[GoogleAuth]";

// Expo Go has no native Google module. It is only loaded outside Expo Go
// (dev build / preview / production), and loaded lazily so Expo Go doesn't
// crash on import.
export const isExpoGo = Constants.executionEnvironment === "storeClient";

let GoogleSignin = null;
let statusCodes = {};

if (!isExpoGo) {
  try {
    const mod = require("@react-native-google-signin/google-signin");
    GoogleSignin = mod.GoogleSignin;
    statusCodes = mod.statusCodes || {};
  } catch (e) {
    console.log(`${TAG} native module failed to load:`, e?.message);
  }
}

let configured = false;

export const configureGoogle = () => {
  if (isExpoGo) {
    throw new Error(
      "Google Sign-In doesn't work in Expo Go. Use a development build (eas build --profile development).",
    );
  }

  if (!GoogleSignin) {
    throw new Error(
      "Google Sign-In native module is missing from this build. Rebuild the app after installing @react-native-google-signin/google-signin.",
    );
  }

  if (!WEB_CLIENT_ID || !WEB_CLIENT_ID.endsWith(".apps.googleusercontent.com")) {
    // This is the #1 cause of "No ID token returned by Google": without a
    // webClientId the library still signs in, but idToken comes back null.
    throw new Error(
      "EXPO_PUBLIC_WEB_CLIENT_ID is missing or invalid in this build. For local runs put it in Stocksy_Mobile/.env; for EAS builds it comes from eas.json. Then restart with a cleared cache (npx expo start -c) or rebuild.",
    );
  }

  if (configured) return;

  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID, // must be the *Web application* OAuth client
    offlineAccess: false,
  });

  configured = true;
  console.log(`${TAG} 1/4 configured with webClientId ${WEB_CLIENT_ID.slice(0, 12)}...`);
};

// Diagnostic only: reads the (unverified) payload so you can compare `aud`
// with GOOGLE_CLIENT_ID on the server. Never logs the token itself.
const logTokenClaims = (idToken) => {
  try {
    const payload = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(global.atob(payload));
    console.log(
      `${TAG} 4/4 token claims: aud=${claims.aud} iss=${claims.iss} exp=${claims.exp} email_verified=${claims.email_verified}`,
    );
  } catch {
    console.log(`${TAG} 4/4 got token (couldn't decode claims for logging)`);
  }
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
  // Android status 10 = DEVELOPER_ERROR: the app's package name + signing
  // SHA-1 don't match any *Android* OAuth client in the same Google Cloud
  // project as the web client ID. This is a console config problem, not code.
  if (code === "10" || /DEVELOPER_ERROR/i.test(msg)) {
    return "DEVELOPER_ERROR: the signing SHA-1 / package name of this build isn't registered in Google Cloud. See the setup checklist.";
  }
  // Status 12500 / 12501 are generic Android sign-in failures / cancel
  if (code === "12500") {
    return "Google sign-in failed (12500). Usually the OAuth consent screen isn't configured, or the account isn't a test user while the app is in Testing mode.";
  }
  return `${msg}${code ? ` (code ${code})` : ""}`;
};

// Returns the Google ID token, or null if the user cancelled.
export const signInWithGoogle = async () => {
  configureGoogle();

  try {
    console.log(`${TAG} 2/4 checking Play Services...`);
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    console.log(`${TAG} 3/4 opening account picker...`);
    const response = await GoogleSignin.signIn();

    // v13+ resolves with { type, data } instead of throwing on cancel
    if (response?.type === "cancelled") {
      console.log(`${TAG} user cancelled`);
      return null;
    }

    const idToken = response?.data?.idToken ?? response?.idToken;

    if (!idToken) {
      console.log(`${TAG} 4/4 signIn succeeded but idToken is empty. Response keys:`, Object.keys(response?.data ?? response ?? {}));
      throw new Error(
        "Google signed you in but returned no ID token. This means the webClientId passed to configure() is wrong or not a Web-type OAuth client.",
      );
    }

    logTokenClaims(idToken);
    return idToken;
  } catch (err) {
    if (String(err?.code) === String(statusCodes.SIGN_IN_CANCELLED)) {
      console.log(`${TAG} user cancelled`);
      return null;
    }
    console.log(`${TAG} FAILED code=${err?.code} message=${err?.message}`);
    throw new Error(describeError(err));
  }
};