import { Linking } from "react-native";
import { PLAY_STORE_PACKAGE, PLAY_STORE_WEB_URL } from "../config/appUpdate";

// Web / PWA install banner on Android. Opens a normal https link in a new tab
// (an https://play.google.com link hands over to the Play app on Android).
// Until the app is published this is the placeholder link, see
// PLAY_STORE_LIVE in config/appUpdate.js.
// Call it straight from the tap handler, with nothing awaited before it, or the
// browser may block the new tab as a popup.
export function openPlayStoreFromWeb() {
  return Linking.openURL(PLAY_STORE_WEB_URL).then(
    () => true,
    (e) => {
      console.log("[install] could not open", PLAY_STORE_WEB_URL, e?.message);
      return false;
    },
  );
}

// Opens the official Stocksy Play Store listing (Play app first, then the
// play.google.com page). Never opens anything else.
export async function openPlayStore() {
  const marketUrl = `market://details?id=${PLAY_STORE_PACKAGE}`;
  const webUrl = `https://play.google.com/store/apps/details?id=${PLAY_STORE_PACKAGE}`;

  for (const url of [marketUrl, webUrl]) {
    try {
      await Linking.openURL(url);
      return true;
    } catch (e) {
      console.log("[appUpdate] could not open", url, e?.message);
    }
  }
  return false;
}