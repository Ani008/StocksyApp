import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * "Have I shown this person the Stock Face-off intro yet?"
 *
 * The animated intro plays every time someone taps the Stock Face-off card until
 * they have COMPLETED the game and the results screen has been shown once (that is
 * when StockOfTheDayPage calls markFaceOffIntroSeen). Quitting part-way does not
 * count. After that the card goes straight to the game (questions, then the
 * result, which the server already locks for the day).
 *
 * The flag lives on the device, per account, so two people sharing a phone each
 * see it once. Logging out clears "user" but not this key, so logging back in does
 * not replay it. A new phone, a reinstall or cleared browser data shows it again once.
 */
// v2: the first build marked the intro "seen" as soon as its loader finished, before
// anyone had played. Those leftover v1 flags are ignored by moving to a new key.
const KEY_PREFIX = "stocksy.faceoff.intro.seen.v2.";

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

/** Remember that this account has finished a game. Best effort: a failed write is ignored. */
export async function markFaceOffIntroSeen() {
  try {
    await AsyncStorage.setItem(await keyForUser(), "1");
  } catch {
    // worst case the intro plays once more
  }
}
