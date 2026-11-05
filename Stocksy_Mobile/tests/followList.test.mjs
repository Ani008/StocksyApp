import test from "node:test";
import assert from "node:assert/strict";
import { FOLLOW_TABS, resolveInitialTab, EMPTY_STATE } from "../src/utils/followList.js";

test("the toggle is Followers | Following, in that order", () => {
  assert.deepEqual(FOLLOW_TABS.map((t) => t.label), ["Followers", "Following"]);
});

test("resolveInitialTab keeps a valid tab", () => {
  assert.equal(resolveInitialTab("followers"), "followers");
  assert.equal(resolveInitialTab("following"), "following");
});

test("resolveInitialTab falls back to followers for anything else", () => {
  for (const bad of [undefined, null, "", "foo", "Following", 3, {}]) {
    assert.equal(resolveInitialTab(bad), "followers");
  }
});

test("every tab has an empty-state title and message", () => {
  for (const { key } of FOLLOW_TABS) {
    assert.ok(EMPTY_STATE[key].title.length > 0);
    assert.ok(EMPTY_STATE[key].message.length > 0);
  }
});
