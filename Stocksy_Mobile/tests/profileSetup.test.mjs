import test from "node:test";
import assert from "node:assert/strict";
import {
  AVATAR_GENDERS,
  apiErrorCode,
  apiErrorMessage,
  avatarPlaceholder,
  genderOfAvatar,
  getSetupNeeds,
  groupAvatarsByGender,
  isCheckable,
  normalizeUsername,
} from "../src/utils/profileSetup.js";

// ── username text ───────────────────────────────────────────────────────────
test("normalizeUsername trims and lowercases; non-strings become empty", () => {
  assert.equal(normalizeUsername("  Rahul_21 "), "rahul_21");
  assert.equal(normalizeUsername(""), "");
  for (const v of [undefined, null, 42, ["a"], {}]) assert.equal(normalizeUsername(v), "");
});

test("isCheckable: only 3+ characters are worth asking the server about", () => {
  assert.equal(isCheckable(""), false);
  assert.equal(isCheckable("ab"), false);
  assert.equal(isCheckable("  ab  "), false); // spaces don't count
  assert.equal(isCheckable("abc"), true);
  assert.equal(isCheckable("ABC"), true);
});

// ── which box to show ───────────────────────────────────────────────────────
test("getSetupNeeds: nothing chosen → both needed, opens on username", () => {
  assert.deepEqual(getSetupNeeds({ username: null, avatarId: null }), {
    needsUsername: true, needsAvatar: true, needsAny: true, firstTab: "username",
  });
});

test("getSetupNeeds: username chosen, no avatar → opens straight on avatar", () => {
  assert.deepEqual(getSetupNeeds({ username: "rahul_21", avatarId: null }), {
    needsUsername: false, needsAvatar: true, needsAny: true, firstTab: "avatar",
  });
});

test("getSetupNeeds: avatar chosen, no username → username", () => {
  const n = getSetupNeeds({ username: null, avatarId: "male_2" });
  assert.deepEqual([n.needsUsername, n.needsAvatar, n.firstTab], [true, false, "username"]);
});

test("getSetupNeeds: everything chosen → box never shows", () => {
  assert.equal(getSetupNeeds({ username: "x_y", avatarId: "female_1" }).needsAny, false);
});

test("getSetupNeeds: a profile that failed to load never triggers the box", () => {
  for (const p of [null, undefined]) assert.equal(getSetupNeeds(p).needsAny, false);
});

test("getSetupNeeds treats empty strings like missing (defensive)", () => {
  assert.equal(getSetupNeeds({ username: "", avatarId: "" }).needsAny, true);
});

// ── placeholder avatars ─────────────────────────────────────────────────────
test("every avatar id the server ships today has a placeholder look", () => {
  for (const gender of AVATAR_GENDERS) {
    for (let i = 1; i <= 6; i++) {
      const p = avatarPlaceholder(`${gender}_${i}`);
      assert.match(p.letter, /^[A-Z]$/);
      assert.match(p.color, /^#[0-9A-F]{6}$/i);
    }
  }
});

test("placeholder letters are distinct within a gender, so avatars are tellable apart", () => {
  for (const gender of AVATAR_GENDERS) {
    const letters = [1, 2, 3, 4, 5, 6].map((i) => avatarPlaceholder(`${gender}_${i}`).letter);
    assert.equal(new Set(letters).size, 6, `${gender}: ${letters}`);
  }
});

test("an avatar id this build doesn't know still renders (grey, first letter)", () => {
  assert.deepEqual(avatarPlaceholder("female_99"), { letter: "F", color: "#94A3B8" });
  assert.equal(avatarPlaceholder("").letter, "?");
  assert.equal(avatarPlaceholder(null).letter, "?");
  assert.equal(avatarPlaceholder(undefined).letter, "?");
});

test("groupAvatarsByGender keeps server order and ignores junk", () => {
  const out = groupAvatarsByGender([
    { id: "male_2", gender: "male" },
    { id: "female_1", gender: "female" },
    { id: "male_1", gender: "male" },
    { id: "x_1", gender: "other" }, // unknown gender
    { id: 5, gender: "male" }, // bad id
    null,
  ]);
  assert.deepEqual(out, { male: ["male_2", "male_1"], female: ["female_1"] });
});

test("groupAvatarsByGender copes with a missing / malformed list", () => {
  for (const v of [undefined, null, "x", {}]) {
    assert.deepEqual(groupAvatarsByGender(v), { male: [], female: [] });
  }
});

test("genderOfAvatar", () => {
  assert.equal(genderOfAvatar("female_3"), "female");
  assert.equal(genderOfAvatar("male_1"), "male");
  for (const v of ["robot_1", "", null, undefined, 7]) assert.equal(genderOfAvatar(v), null);
});

// ── API errors ──────────────────────────────────────────────────────────────
test("apiErrorMessage prefers the server's message, explains a dead network, else falls back", () => {
  assert.equal(apiErrorMessage({ response: { data: { message: "That username is already taken." } } }), "That username is already taken.");
  assert.match(apiErrorMessage({ request: {} }), /No connection/);
  assert.equal(apiErrorMessage({ response: { data: {} } }, "fallback"), "fallback");
  assert.equal(apiErrorMessage(undefined, "fallback"), "fallback");
  assert.equal(apiErrorMessage({ response: { data: { message: 42 } } }, "fb"), "fb");
});

test("apiErrorCode", () => {
  assert.equal(apiErrorCode({ response: { data: { code: "USERNAME_TAKEN" } } }), "USERNAME_TAKEN");
  assert.equal(apiErrorCode({}), null);
  assert.equal(apiErrorCode(undefined), null);
});
