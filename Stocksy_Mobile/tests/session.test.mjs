import test from "node:test";
import assert from "node:assert/strict";

const state = (globalThis.__stubState ??= {
  platform: "web",
  asyncStore: new Map(),
  secureStore: new Map(),
  posts: [],
  responder: async () => ({ data: {} }),
});

const store = await import("../services/tokenStore.js");
const mgr = await import("../services/sessionManager.js");

const httpError = (status) => Object.assign(new Error("http"), { response: { status } });
const networkError = () => Object.assign(new Error("network"), { request: {} });
const session = (over = {}) => ({
  id: "user-1",
  token: "access-1",
  expiresIn: 900,
  ...over,
});

test.beforeEach(async () => {
  state.platform = "web";
  state.posts.length = 0;
  state.asyncStore.clear();
  state.secureStore.clear();
  state.responder = async () => ({ data: session() });
  await store.clearSession();
});

test("web: the access token is kept in memory and NOTHING is written to storage", async () => {
  await store.saveSession(session({ refreshToken: "must-not-be-stored" }));
  assert.equal(await store.getAccessToken(), "access-1");
  assert.equal(state.asyncStore.size, 0, "no localStorage/AsyncStorage on web");
  assert.equal(state.secureStore.size, 0);
  assert.equal(await store.getRefreshToken(), null, "web never holds a refresh token in JS");
});

test("native: access token in AsyncStorage, refresh token in secure storage only", async () => {
  state.platform = "native";
  await store.saveSession(session({ refreshToken: "rt-1" }));
  assert.equal(state.asyncStore.get("token"), "access-1");
  assert.equal(state.asyncStore.get("userId"), "user-1");
  assert.equal(state.secureStore.get("stocksy_refresh_token"), "rt-1");
  assert.ok(![...state.asyncStore.values()].includes("rt-1"), "refresh token is NOT in AsyncStorage");
});

test("clearSession wipes memory, storage, the stored user and the refresh token", async () => {
  state.platform = "native";
  await store.saveSession(session({ refreshToken: "rt-1" }));
  state.asyncStore.set("user", '{"email":"a@b.c"}');
  await store.clearSession();
  assert.equal(await store.getAccessToken(), null);
  assert.equal(await store.getRefreshToken(), null);
  assert.equal(state.asyncStore.size, 0);
  assert.equal(state.secureStore.size, 0);
});

test("web refresh: cookie mode, credentials sent, empty body, new token stored", async () => {
  state.responder = async () => ({ data: session({ token: "access-2" }) });
  const data = await mgr.refreshSession();
  assert.equal(data.token, "access-2");
  assert.equal(await store.getAccessToken(), "access-2");
  const call = state.posts[0];
  assert.equal(call.url, "https://api.test/api/auth/refresh");
  assert.deepEqual(call.body, {});
  assert.equal(call.config.withCredentials, true);
  assert.equal(call.config.headers["X-Auth-Mode"], "cookie");
});

test("native refresh: sends the stored refresh token in the body and stores the rotated one", async () => {
  state.platform = "native";
  await store.saveSession(session({ refreshToken: "rt-1" }));
  state.responder = async () => ({ data: session({ token: "access-2", refreshToken: "rt-2" }) });
  await mgr.refreshSession();
  assert.deepEqual(state.posts[0].body, { refreshToken: "rt-1" });
  assert.equal(state.secureStore.get("stocksy_refresh_token"), "rt-2");
});

test("native refresh with no refresh token makes no request and reports signed out", async () => {
  state.platform = "native";
  assert.equal(await mgr.refreshSession(), null);
  assert.equal(state.posts.length, 0);
});

test("simultaneous refreshes share ONE request (the refresh token is single-use)", async () => {
  let release;
  state.responder = () => new Promise((r) => (release = () => r({ data: session({ token: "access-9" }) })));
  const calls = [mgr.refreshSession(), mgr.refreshSession(), mgr.refreshSession()];
  await new Promise((r) => setImmediate(r));
  release();
  const results = await Promise.all(calls);
  assert.equal(state.posts.length, 1);
  assert.ok(results.every((r) => r.token === "access-9"));
});

test("server refuses the refresh (401): session is cleared and null is returned", async () => {
  await store.saveSession(session());
  state.responder = async () => { throw httpError(401); };
  assert.equal(await mgr.refreshSession(), null);
  assert.equal(await store.getAccessToken(), null);
});

test("offline during refresh: the error propagates and the session is KEPT", async () => {
  await store.saveSession(session());
  state.responder = async () => { throw networkError(); };
  await assert.rejects(mgr.refreshSession());
  assert.equal(await store.getAccessToken(), "access-1");
});

test("getValidAccessToken: fresh token is returned without a request", async () => {
  await store.saveSession(session({ expiresIn: 900 }));
  assert.equal(await mgr.getValidAccessToken(), "access-1");
  assert.equal(state.posts.length, 0);
});

test("getValidAccessToken: a token inside the 90 s skew is refreshed first", async () => {
  await store.saveSession(session({ expiresIn: 60 }));
  state.responder = async () => ({ data: session({ token: "access-2" }) });
  assert.equal(await mgr.getValidAccessToken(), "access-2");
});

test("getValidAccessToken: offline returns the token it has, signed out returns null", async () => {
  await store.saveSession(session({ expiresIn: 30 }));
  state.responder = async () => { throw networkError(); };
  assert.equal(await mgr.getValidAccessToken(), "access-1");

  state.responder = async () => { throw httpError(401); };
  assert.equal(await mgr.getValidAccessToken(), null);
});

test("restoreSession (web): true when the cookie is valid, false when refused, true when offline", async () => {
  assert.equal(await mgr.restoreSession(), true);
  assert.equal(await store.getAccessToken(), "access-1");

  await store.clearSession();
  state.responder = async () => { throw httpError(401); };
  assert.equal(await mgr.restoreSession(), false);

  state.responder = async () => { throw networkError(); };
  assert.equal(await mgr.restoreSession(), true);
});

test("restoreSession (native): signed in iff a token is stored; makes no request", async () => {
  state.platform = "native";
  assert.equal(await mgr.restoreSession(), false);
  await store.saveSession(session({ refreshToken: "rt-1" }));
  assert.equal(await mgr.restoreSession(), true);
  assert.equal(state.posts.length, 0);
});
