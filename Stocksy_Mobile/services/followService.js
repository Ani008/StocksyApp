// services/followService.js
//
// Calls for the follow system (backend: Stocksy_Server/routes/users.js).
//
// Reading calls (search, lists) are `silent`: search runs while the person is
// typing, so api.js must not pop an error toast per keystroke — the page shows
// its own message. Follow / unfollow are NOT silent: they are a deliberate tap,
// so a failure (offline, rate limit) should tell the person via the usual toast.

import api from "./api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { safeCount } from "../src/utils/followCounts";

const enc = encodeURIComponent;

/**
 * Find people by username or name. Resolves an array of users (see
 * src/utils/followUsers.js). The server returns [] for text under 2 characters.
 */
export const searchUsers = async (q) => {
  const res = await api.get("/users/search", { params: { q }, silent: true });
  return res.data?.users ?? [];
};

/**
 * One page of the logged-in user's followers or following, newest first.
 * `tab` is "followers" | "following"; pass the previous `nextCursor` for the
 * next page. Resolves { users, nextCursor } (nextCursor null = last page).
 */
export const getConnections = async (tab, { cursor } = {}) => {
  const which = tab === "following" ? "following" : "followers";
  const res = await api.get(`/users/me/${which}`, { params: { cursor }, silent: true });
  return { users: res.data?.users ?? [], nextCursor: res.data?.nextCursor ?? null };
};

/** Follow someone. Resolves { isFollowing: true, followersCount } (their new count). */
export const followUser = async (userId) => {
  const res = await api.post(`/users/${enc(userId)}/follow`);
  return res.data;
};

/** Unfollow someone. Resolves { isFollowing: false, followersCount }. */
export const unfollowUser = async (userId) => {
  const res = await api.delete(`/users/${enc(userId)}/follow`);
  return res.data;
};

/**
 * The Profile screen shows the counts it last stored on the phone straight
 * away, then corrects them from the server. After a follow / unfollow, move the
 * stored "following" number by `delta` (+1 / -1) so the Profile is already right
 * when the person goes back. Best effort — the server stays the source of truth.
 */
export const bumpStoredFollowingCount = async (delta) => {
  try {
    const raw = await AsyncStorage.getItem("user");
    if (!raw) return;
    const stored = JSON.parse(raw);
    await AsyncStorage.setItem(
      "user",
      JSON.stringify({ ...stored, followingCount: safeCount((stored.followingCount ?? 0) + delta) }),
    );
  } catch {
    /* the Profile re-reads the real count from the server anyway */
  }
};
