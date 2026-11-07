import test from "node:test";
import assert from "node:assert/strict";
import {
  LEADERBOARD_TABS,
  DEFAULT_TAB,
  PODIUM_SIZE,
  toBoardEntry,
  normalizeBoard,
  splitBoard,
  pinnedMe,
  isFriendsAlone,
  rankSummary,
} from "../src/utils/leaderboard.js";

const raw = (over = {}) => ({
  rank: 1,
  id: "u1",
  fullName: "Asha Rao",
  username: "asha",
  avatar: "",
  avatarId: "female_1",
  points: 40,
  isSelf: false,
  ...over,
});

test("tabs are Friends then Global, and Friends is the default", () => {
  assert.deepEqual(LEADERBOARD_TABS.map((t) => t.key), ["friends", "global"]);
  assert.equal(DEFAULT_TAB, "friends");
  assert.equal(PODIUM_SIZE, 3);
});

test("an entry shows the username, falling back to the full name", () => {
  assert.equal(toBoardEntry(raw()).name, "asha");
  assert.equal(toBoardEntry(raw({ username: null })).name, "Asha Rao");
  assert.equal(toBoardEntry(raw({ username: null, fullName: "" })).name, "Trader");
});

test("an entry keeps the server's rank, points, avatar and isSelf", () => {
  assert.deepEqual(toBoardEntry(raw({ rank: 7, points: 95, isSelf: true })), {
    id: "u1",
    rank: 7,
    name: "asha",
    points: 95,
    avatarId: "female_1",
    avatarUrl: null,
    isSelf: true,
  });
});

test("the Google photo is carried only as a fallback, a missing avatar is null", () => {
  const e = toBoardEntry(raw({ avatarId: null, avatar: "https://x.test/p.png" }));
  assert.equal(e.avatarId, null);
  assert.equal(e.avatarUrl, "https://x.test/p.png");
});

test("points are whole and never negative or NaN", () => {
  assert.equal(toBoardEntry(raw({ points: 12.6 })).points, 13);
  assert.equal(toBoardEntry(raw({ points: -5 })).points, 0);
  assert.equal(toBoardEntry(raw({ points: undefined })).points, 0);
  assert.equal(toBoardEntry(raw({ points: "40" })).points, 0); // the server sends numbers
});

test("entries that can't be drawn are dropped (no id, bad rank)", () => {
  assert.equal(toBoardEntry(null), null);
  assert.equal(toBoardEntry({}), null);
  assert.equal(toBoardEntry(raw({ id: "" })), null);
  assert.equal(toBoardEntry(raw({ id: 5 })), null);
  assert.equal(toBoardEntry(raw({ rank: 0 })), null);
  assert.equal(toBoardEntry(raw({ rank: 1.5 })), null);
  assert.equal(toBoardEntry(raw({ rank: "2" })), null);
});

test("normalizeBoard maps the response and keeps the server's order", () => {
  const board = normalizeBoard({
    scope: "global",
    total: 340,
    entries: [raw({ rank: 1, id: "a" }), raw({ rank: 2, id: "b" }), null, { nope: true }],
    me: raw({ rank: 340, id: "me", isSelf: true }),
  });
  assert.deepEqual(board.entries.map((e) => e.id), ["a", "b"]);
  assert.equal(board.me.rank, 340);
  assert.equal(board.total, 340);
});

test("normalizeBoard survives a missing or malformed response", () => {
  for (const bad of [undefined, null, {}, { entries: "x" }, { entries: {}, me: 3 }]) {
    const board = normalizeBoard(bad);
    assert.deepEqual(board.entries, []);
    assert.equal(board.me, null);
    assert.equal(board.total, 0);
  }
});

test("total falls back to the number of rows when the server omits it", () => {
  assert.equal(normalizeBoard({ entries: [raw()] }).total, 1);
  assert.equal(normalizeBoard({ entries: [raw()], total: -4 }).total, 1);
});

test("the podium is the first three, the list is everyone after", () => {
  const entries = [1, 2, 3, 4, 5].map((rank) => toBoardEntry(raw({ rank, id: `u${rank}` })));
  const { podium, rest } = splitBoard(entries);
  assert.deepEqual(podium.map((e) => e.rank), [1, 2, 3]);
  assert.deepEqual(rest.map((e) => e.rank), [4, 5]);

  const small = splitBoard(entries.slice(0, 2));
  assert.equal(small.podium.length, 2);
  assert.deepEqual(small.rest, []);
  assert.deepEqual(splitBoard([]), { podium: [], rest: [] });
});

test("your row is pinned only when you are not already in the list", () => {
  const me = toBoardEntry(raw({ rank: 340, id: "me", isSelf: true }));
  const others = [1, 2].map((rank) => toBoardEntry(raw({ rank, id: `u${rank}` })));

  assert.equal(pinnedMe({ entries: others, me, total: 340 }).rank, 340);

  const inList = toBoardEntry(raw({ rank: 3, id: "me", isSelf: true }));
  assert.equal(pinnedMe({ entries: [...others, inList], me: inList, total: 3 }), null);

  assert.equal(pinnedMe({ entries: others, me: null, total: 2 }), null);
  assert.equal(pinnedMe(null), null);
});

test("the friends board with nobody followed is detected, the global board never is", () => {
  assert.equal(isFriendsAlone("friends", { total: 1 }), true);
  assert.equal(isFriendsAlone("friends", { total: 0 }), true);
  assert.equal(isFriendsAlone("friends", { total: 2 }), false);
  assert.equal(isFriendsAlone("global", { total: 1 }), false);
  assert.equal(isFriendsAlone("friends", null), true);
});

test("rankSummary reads '#rank of total'", () => {
  assert.equal(rankSummary({ rank: 340 }, 1204), "#340 of 1,204");
  assert.equal(rankSummary({ rank: 2 }, 0), "#2");
  assert.equal(rankSummary(null, 10), "");
});
