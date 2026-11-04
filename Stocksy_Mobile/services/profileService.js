// services/profileService.js
//
// Calls for the username / avatar / edit-profile endpoints.
//
// Every call here is `silent`: api.js would otherwise pop an error toast for
// each failure, and these run in the background (a check on every pause in
// typing, a lookup when the app opens). The screens that call them show their
// own message where it belongs.

import api from "./api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizeUsername } from "../src/utils/profileSetup";

/**
 * Is this username free? Resolves { available: true, username } or
 * { available: false, reason, message } — reason is one of TOO_SHORT, TOO_LONG,
 * INVALID_CHARACTERS, INVALID_FORMAT, RESERVED, TAKEN, REQUIRED, and `message`
 * is ready to show. Public endpoint (works before login, on the signup screen).
 */
export const checkUsername = async (username) => {
  const res = await api.get("/auth/username-available", {
    params: { username: normalizeUsername(username) },
    silent: true,
  });
  return res.data;
};

/** The avatars that can be picked: [{ id: "female_3", gender: "female" }, ...] */
export const getAvatars = async () => {
  const res = await api.get("/avatars", { silent: true });
  return res.data?.avatars ?? [];
};

/**
 * The logged-in user's own profile. `username` is null until they have chosen
 * one and `avatarId` is null until they have picked an avatar — that is what
 * decides whether the setup box is shown.
 */
export const getMyProfile = async () => {
  const res = await api.get("/users/me", { silent: true });
  return res.data.user;
};

// Screens such as Dashboard and Profile read the logged-in user from storage
// ("user"), so keep that copy in step with what was just saved. A no-op when
// nothing is stored (nobody to update).
const updateStoredUser = async (account) => {
  try {
    const raw = await AsyncStorage.getItem("user");
    if (!raw) return;
    const stored = JSON.parse(raw);
    await AsyncStorage.setItem(
      "user",
      JSON.stringify({
        ...stored,
        username: account.username,
        usernameSet: Boolean(account.usernameSet),
        fullName: account.fullName,
        avatar: account.avatar,
        avatarId: account.avatarId ?? null,
      }),
    );
  } catch {
    /* the saved profile is on the server either way */
  }
};

/**
 * Saves any of { fullName, username, avatarId } and resolves the updated
 * account (same shape as login: usernameSet, avatarId, ...). Rejects with the
 * request error: code USERNAME_TAKEN (409) when someone got the username first.
 */
export const updateMyProfile = async (changes) => {
  const res = await api.patch("/users/me", changes, { silent: true });
  await updateStoredUser(res.data.user);
  return res.data.user;
};
