import test from "node:test";
import assert from "node:assert/strict";
import { offsetForPage, pageFromOffset } from "../src/utils/carousel.js";

test("pageFromOffset: snaps to the nearest page", () => {
  assert.equal(pageFromOffset(0, 300, 2), 0);
  assert.equal(pageFromOffset(149, 300, 2), 0);
  assert.equal(pageFromOffset(150, 300, 2), 1);
  assert.equal(pageFromOffset(300, 300, 2), 1);
});

test("pageFromOffset: iOS rubber-banding and bad input stay in range", () => {
  assert.equal(pageFromOffset(-80, 300, 2), 0);
  assert.equal(pageFromOffset(900, 300, 2), 1);
  assert.equal(pageFromOffset(NaN, 300, 2), 0);
  assert.equal(pageFromOffset(100, 0, 2), 0, "not measured yet");
  assert.equal(pageFromOffset(100, 300, 0), 0);
});

test("offsetForPage: left edge of a page, clamped", () => {
  assert.equal(offsetForPage(0, 300, 2), 0);
  assert.equal(offsetForPage(1, 300, 2), 300);
  assert.equal(offsetForPage(5, 300, 2), 300);
  assert.equal(offsetForPage(-1, 300, 2), 0);
  assert.equal(offsetForPage(1, 0, 2), 0);
});
