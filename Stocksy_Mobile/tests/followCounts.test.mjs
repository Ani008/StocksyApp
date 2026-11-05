import test from "node:test";
import assert from "node:assert/strict";
import {
  safeCount,
  formatCount,
  followersLabel,
  followingLabel,
} from "../src/utils/followCounts.js";

test("safeCount: bad input becomes 0", () => {
  for (const bad of [undefined, null, NaN, "5", -3, Infinity, {}]) {
    assert.equal(safeCount(bad), 0);
  }
  assert.equal(safeCount(7), 7);
  assert.equal(safeCount(7.9), 7);
});

test("formatCount: zero and one show exactly", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(1), "1");
  assert.equal(formatCount(999), "999");
});

test("formatCount: thousands and millions, rounded down", () => {
  assert.equal(formatCount(1000), "1K");
  assert.equal(formatCount(1250), "1.2K");
  assert.equal(formatCount(1999), "1.9K");
  assert.equal(formatCount(12500), "12.5K");
  assert.equal(formatCount(1_000_000), "1M");
  assert.equal(formatCount(2_450_000), "2.4M");
});

test("formatCount: missing values read as 0", () => {
  assert.equal(formatCount(undefined), "0");
  assert.equal(formatCount(null), "0");
});

test("accessibility labels use the right singular / plural", () => {
  assert.equal(followersLabel(0), "0 followers");
  assert.equal(followersLabel(1), "1 follower");
  assert.equal(followersLabel(2), "2 followers");
  assert.equal(followingLabel(1), "1 following");
  assert.equal(followingLabel(undefined), "0 following");
});
