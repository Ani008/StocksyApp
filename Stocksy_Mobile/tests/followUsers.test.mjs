import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanQuery,
  isSearchable,
  primaryName,
  secondaryName,
  followButtonState,
  normalizeUsers,
  withFollowState,
  mergeUsers,
} from "../src/utils/followUsers.js";

const user = (over = {}) => ({
  id: "u1",
  fullName: "Asha Rao",
  username: "asha",
  avatarId: "female_1",
  isSelf: false,
  isFollowing: false,
  followsYou: false,
  ...over,
});

test("search needs 2+ characters after trimming", () => {
  assert.equal(isSearchable(""), false);
  assert.equal(isSearchable(" a "), false);
  assert.equal(isSearchable("as"), true);
  assert.equal(isSearchable(undefined), false);
});

test("cleanQuery trims and collapses spaces", () => {
  assert.equal(cleanQuery("  asha   rao "), "asha rao");
  assert.equal(cleanQuery(null), "");
});

test("big line is the username, falling back to the full name", () => {
  assert.equal(primaryName(user()), "asha");
  assert.equal(primaryName(user({ username: null })), "Asha Rao");
  assert.equal(primaryName(user({ username: null, fullName: "" })), "Trader");
});

test("small line shows the full name only when it adds something", () => {
  assert.equal(secondaryName(user()), "Asha Rao");
  assert.equal(secondaryName(user({ username: null })), "");
  assert.equal(secondaryName(user({ username: "ASHA RAO" })), "");
});

test("follow button: Follow / Follow back / Following / hidden on self", () => {
  assert.deepEqual(followButtonState(user()), { label: "Follow", filled: true, action: "follow" });
  assert.deepEqual(followButtonState(user({ followsYou: true })), {
    label: "Follow back",
    filled: true,
    action: "follow",
  });
  assert.deepEqual(followButtonState(user({ isFollowing: true, followsYou: true })), {
    label: "Following",
    filled: false,
    action: "unfollow",
  });
  assert.equal(followButtonState(user({ isSelf: true })), null);
  assert.equal(followButtonState(null), null);
});

test("normalizeUsers drops entries without an id", () => {
  assert.deepEqual(normalizeUsers([user(), null, { fullName: "x" }, { id: "" }]).map((u) => u.id), ["u1"]);
  assert.deepEqual(normalizeUsers(undefined), []);
});

test("withFollowState changes only the matching person", () => {
  const list = [user({ id: "a" }), user({ id: "b" })];
  const next = withFollowState(list, "b", true);
  assert.equal(next[0].isFollowing, false);
  assert.equal(next[1].isFollowing, true);
  assert.equal(list[1].isFollowing, false); // original untouched
});

test("mergeUsers appends a page without repeating anyone", () => {
  const first = [user({ id: "a" }), user({ id: "b" })];
  const merged = mergeUsers(first, [user({ id: "b" }), user({ id: "c" })]);
  assert.deepEqual(merged.map((u) => u.id), ["a", "b", "c"]);
  assert.equal(mergeUsers(first, [user({ id: "a" })]), first);
});
