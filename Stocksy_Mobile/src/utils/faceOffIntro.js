import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * "Have I shown this person the Stock Face-off intro yet?"
 *
 * The animated intro plays once, the very first time someone taps the Stock
 * Face-off card. After that the card goes straight to the game (questions, then
 * the result, which the server already locks for the day).
 *
 * The flag lives on the device, per account, so two people sharing a phone each
 * see it once. Logging out clears "user" but not this key, so logging back in does
 * not replay it. A new phone, a reinstall or cleared browser data shows it again once.
 */
const KEY_PREFIX = "stocksy.faceoff.intro.seen.v1.";

// Same account id the streak cache uses, so both agree on who "this person" is.
async function keyForUser() {
  let id = "guest";
  try {
    const raw = await AsyncStorage.getItem("user");
    const user = raw ? JSON.parse(raw) : null;
    id = user?.id ?? user?.email ?? user?.username ?? "guest";
  } catch {
    // fall back to the guest key
  }
  return `${KEY_PREFIX}${id}`;
}

/**
 * True once the intro has been shown to this account. If storage can't be read we
 * answer true: skipping a one-off animation is better than replaying it every tap.
 */
export async function hasSeenFaceOffIntro() {
  try {
    return (await AsyncStorage.getItem(await keyForUser())) === "1";
  } catch {
    return true;
  }
}

/** Remember that the intro has been shown. Best effort: a failed write is ignored. */
export async function markFaceOffIntroSeen() {
  try {
    await AsyncStorage.setItem(await keyForUser(), "1");
  } catch {
    // worst case the intro plays once more
  }
}
