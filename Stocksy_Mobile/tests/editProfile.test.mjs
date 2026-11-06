import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FULL_NAME_LENGTH,
  cleanFullName,
  firstNameOf,
  fullNameError,
  profileChanges,
} from "../src/utils/editProfile.js";

test("firstNameOf takes the first word and capitalises it", () => {
  assert.equal(firstNameOf("Aniket Chakke"), "Aniket");
  assert.equal(firstNameOf("  aniket   chakke "), "Aniket");
  assert.equal(firstNameOf("Madonna"), "Madonna");
});

test("firstNameOf gives an empty string when there is no name", () => {
  for (const bad of [undefined, null, "", "   ", 42, {}]) assert.equal(firstNameOf(bad), "");
});

test("firstNameOf leaves non-Latin names intact", () => {
  assert.equal(firstNameOf("अनिकेत चक्के"), "अनिकेत");
});

test("cleanFullName trims and collapses spaces", () => {
  assert.equal(cleanFullName("  Ani   Chakke "), "Ani Chakke");
  assert.equal(cleanFullName(null), "");
});

test("fullNameError: empty and too long are refused, normal names pass", () => {
  assert.notEqual(fullNameError("   "), "");
  assert.notEqual(fullNameError("a".repeat(MAX_FULL_NAME_LENGTH + 1)), "");
  assert.equal(fullNameError("Aniket Chakke"), "");
  assert.equal(fullNameError("a".repeat(MAX_FULL_NAME_LENGTH)), "");
});

test("profileChanges sends only what changed, never username or email", () => {
  const original = { fullName: "Aniket Chakke", avatarId: "male_1" };

  assert.deepEqual(profileChanges(original, { ...original }), {});
  assert.deepEqual(profileChanges(original, { fullName: "  Aniket   Chakke ", avatarId: "male_1" }), {});
  assert.deepEqual(profileChanges(original, { fullName: "Ani C", avatarId: "male_1" }), { fullName: "Ani C" });
  assert.deepEqual(profileChanges(original, { fullName: "Aniket Chakke", avatarId: "female_2" }), {
    avatarId: "female_2",
  });
  assert.deepEqual(
    profileChanges(original, { fullName: "Ani C", avatarId: "female_2", username: "x", email: "y@z" }),
    { fullName: "Ani C", avatarId: "female_2" },
  );
});

test("profileChanges treats a first-time avatar pick as a change, and an empty name as none", () => {
  assert.deepEqual(profileChanges({ fullName: "A B", avatarId: null }, { fullName: "A B", avatarId: "male_3" }), {
    avatarId: "male_3",
  });
  assert.deepEqual(profileChanges({ fullName: "A B", avatarId: "male_3" }, { fullName: "  ", avatarId: "male_3" }), {});
});
