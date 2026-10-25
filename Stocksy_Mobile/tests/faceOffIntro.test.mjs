import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { hasSeenFaceOffIntro, markFaceOffIntroSeen } from "../src/utils/faceOffIntro.js";

const store = () => globalThis.__stubState.asyncStore;
const signIn = (user) => store().set("user", JSON.stringify(user));

beforeEach(() => store().clear());

test("a new account has not seen the intro", async () => {
  signIn({ id: 7 });
  assert.equal(await hasSeenFaceOffIntro(), false);
});

test("once marked, the intro counts as seen", async () => {
  signIn({ id: 7 });
  await markFaceOffIntroSeen();
  assert.equal(await hasSeenFaceOffIntro(), true);
});

test("it is remembered per account, not per device", async () => {
  signIn({ id: 7 });
  await markFaceOffIntroSeen();
  signIn({ id: 8 });
  assert.equal(await hasSeenFaceOffIntro(), false);
  signIn({ id: 7 });
  assert.equal(await hasSeenFaceOffIntro(), true);
});

test("logging out and back in does not replay it", async () => {
  signIn({ email: "a@b.c" });
  await markFaceOffIntroSeen();
  store().delete("user"); // logout clears "user" only
  signIn({ email: "a@b.c" });
  assert.equal(await hasSeenFaceOffIntro(), true);
});

test("an unreadable user record falls back to a shared guest key", async () => {
  store().set("user", "{not json");
  assert.equal(await hasSeenFaceOffIntro(), false);
  await markFaceOffIntroSeen();
  assert.equal(await hasSeenFaceOffIntro(), true);
});
