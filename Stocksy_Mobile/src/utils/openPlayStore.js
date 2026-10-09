import { Linking } from "react-native";
import { PLAY_STORE_PACKAGE } from "../config/appUpdate";

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