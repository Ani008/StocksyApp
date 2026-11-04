import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  checkUsername,
  getAvatars,
  getMyProfile,
  updateMyProfile,
} from "../services/profileService.js";

const state = globalThis.__stubState;

beforeEach(() => {
  state.posts.length = 0;
  state.asyncStore.clear();
  state.responder = async () => ({ data: {} });
});

const lastCall = () => state.posts[state.posts.length - 1];

test("checkUsername sends the lowercase name, SILENTLY, and returns the server's verdict", async () => {
  state.responder = async () => ({ data: { available: false, reason: "TAKEN", message: "That username is already taken." } });
  const r = await checkUsername("  Rahul_21 ");
  assert.equal(lastCall().method, "get");
  assert.equal(lastCall().url, "/auth/username-available");
  assert.deepEqual(lastCall().config.params, { username: "rahul_21" });
  assert.equal(lastCall().config.silent, true, "a check per keystroke must never toast");
  assert.equal(r.reason, "TAKEN");
});

test("getAvatars returns the list, [] when the server sends none; silent", async () => {
  state.responder = async () => ({ data: { avatars: [{ id: "male_1", gender: "male" }] } });
  assert.deepEqual(await getAvatars(), [{ id: "male_1", gender: "male" }]);
  assert.equal(lastCall().url, "/avatars");
  assert.equal(lastCall().config.silent, true);

  state.responder = async () => ({ data: {} });
  assert.deepEqual(await getAvatars(), []);
});

test("getMyProfile reads /users/me, silent, and unwraps { user }", async () => {
  state.responder = async () => ({ data: { user: { id: "u1", username: null, avatarId: null } } });
  const me = await getMyProfile();
  assert.equal(lastCall().url, "/users/me");
  assert.equal(lastCall().config.silent, true);
  assert.deepEqual(me, { id: "u1", username: null, avatarId: null });
});

test("a failed request rejects (callers decide what to show)", async () => {
  state.responder = async () => { throw Object.assign(new Error("boom"), { response: { status: 500 } }); };
  await assert.rejects(() => getMyProfile(), /boom/);
  await assert.rejects(() => checkUsername("abc"), /boom/);
  await assert.rejects(() => getAvatars(), /boom/);
});

test("updateMyProfile PATCHes only what it was given, silently, and returns the account", async () => {
  const account = { id: "u1", username: "rahul_21", usernameSet: true, fullName: "Rahul P", avatar: "", avatarId: "male_2" };
  state.responder = async () => ({ data: { message: "Profile updated", user: account } });

  const out = await updateMyProfile({ username: "rahul_21", avatarId: "male_2" });

  assert.equal(lastCall().method, "patch");
  assert.equal(lastCall().url, "/users/me");
  assert.deepEqual(lastCall().body, { username: "rahul_21", avatarId: "male_2" });
  assert.equal(lastCall().config.silent, true);
  assert.deepEqual(out, account);
});

test("updateMyProfile keeps the stored user (read by Dashboard / Profile) in step", async () => {
  state.asyncStore.set("user", JSON.stringify({ id: "u1", username: "Rahul", usernameSet: false, fullName: "Rahul P", email: "r@x.com", avatar: "", avatarId: null }));
  state.responder = async () => ({
    data: { user: { id: "u1", username: "rahul_21", usernameSet: true, fullName: "Rahul P", avatar: "", avatarId: "male_2" } },
  });

  await updateMyProfile({ username: "rahul_21", avatarId: "male_2" });

  const stored = JSON.parse(state.asyncStore.get("user"));
  assert.equal(stored.username, "rahul_21");
  assert.equal(stored.usernameSet, true);
  assert.equal(stored.avatarId, "male_2");
  assert.equal(stored.email, "r@x.com", "fields the response doesn't carry must survive");
  assert.equal(stored.id, "u1");
});

test("updateMyProfile with nothing stored doesn't invent a user", async () => {
  state.responder = async () => ({ data: { user: { id: "u1", username: "x_y", usernameSet: true, avatarId: null } } });
  await updateMyProfile({ username: "x_y" });
  assert.equal(state.asyncStore.has("user"), false);
});

test("a taken username rejects with the server's code intact, and leaves the stored user alone", async () => {
  state.asyncStore.set("user", JSON.stringify({ id: "u1", username: "Rahul", usernameSet: false }));
  state.responder = async () => {
    throw Object.assign(new Error("409"), { response: { status: 409, data: { code: "USERNAME_TAKEN" } } });
  };
  await assert.rejects(
    () => updateMyProfile({ username: "taken" }),
    (err) => err.response.data.code === "USERNAME_TAKEN",
  );
  assert.equal(JSON.parse(state.asyncStore.get("user")).usernameSet, false);
});
