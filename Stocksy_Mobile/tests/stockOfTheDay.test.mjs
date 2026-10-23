import test from "node:test";
import assert from "node:assert/strict";
import {
  answersText,
  formatValue,
  groupIndian,
  isGrowthLabel,
  scoreHeadline,
  sidesOf,
} from "../src/utils/stockOfTheDay.js";

test("groupIndian: last three digits, then pairs", () => {
  assert.equal(groupIndian(0), "0");
  assert.equal(groupIndian(999), "999");
  assert.equal(groupIndian(1000), "1,000");
  assert.equal(groupIndian(99999), "99,999");
  assert.equal(groupIndian(318556), "3,18,556");
  assert.equal(groupIndian(12345678), "1,23,45,678");
  assert.equal(groupIndian(-318556), "-3,18,556");
  assert.equal(groupIndian(1234.6), "1,235");
});

test("market value: crore with Indian grouping, lakh crore from 1,00,000", () => {
  assert.equal(formatValue("inr_cr", 259493.2), "₹2.59 lakh Cr");
  assert.equal(formatValue("inr_cr", 54298.37), "₹54,298 Cr");
  assert.equal(formatValue("inr_cr", 99999.4), "₹99,999 Cr");
  assert.equal(formatValue("inr_cr", 515826), "₹5.16 lakh Cr");
  assert.equal(formatValue("inr_cr", 100000), "₹1.00 lakh Cr");
  assert.equal(formatValue("inr_cr", 1114293.3), "₹11.14 lakh Cr");
});

test("percent: one decimal, optional explicit sign", () => {
  assert.equal(formatValue("pct", 31.26), "31.3%");
  assert.equal(formatValue("pct", 10.2, { signed: true }), "+10.2%");
  assert.equal(formatValue("pct", -21.9, { signed: true }), "-21.9%");
  assert.equal(formatValue("pct", -21.9), "-21.9%");
  assert.equal(formatValue("pct", 6.5), "6.5%");
});

test("percent: values that round to zero never show a sign", () => {
  assert.equal(formatValue("pct", -0.04, { signed: true }), "0.0%");
  assert.equal(formatValue("pct", 0.04, { signed: true }), "0.0%");
  assert.equal(formatValue("pct", 0, { signed: true }), "0.0%");
});

test("ratio: one decimal, none for triple digits", () => {
  assert.equal(formatValue("x", 37.34), "37.3x");
  assert.equal(formatValue("x", 2.03), "2.0x");
  assert.equal(formatValue("x", 120), "120x");
});

test("bad numbers are N/A, never NaN or undefined", () => {
  for (const bad of [NaN, Infinity, undefined, null, "12", {}]) {
    assert.equal(formatValue("pct", bad), "N/A");
    assert.equal(formatValue("inr_cr", bad), "N/A");
  }
});

test("isGrowthLabel: only the two growth questions get a sign", () => {
  assert.equal(isGrowthLabel("Sales growth"), true);
  assert.equal(isGrowthLabel("Profit growth"), true);
  assert.equal(isGrowthLabel("Profit margin"), false);
  assert.equal(isGrowthLabel(undefined), false);
});

test("scoreHeadline: every score has a sensible line", () => {
  assert.equal(scoreHeadline(5, 5), "Perfect score!");
  assert.equal(scoreHeadline(4, 5), "Nice one!");
  assert.equal(scoreHeadline(3, 5), "Nice one!");
  assert.equal(scoreHeadline(2, 5), "Tougher than it looks");
  assert.equal(scoreHeadline(1, 5), "Tougher than it looks");
  assert.match(scoreHeadline(0, 5), /Tough day/);
  // shorter days (3 or 4 rounds) still work
  assert.equal(scoreHeadline(3, 3), "Perfect score!");
  assert.equal(scoreHeadline(2, 3), "Nice one!");
  assert.equal(scoreHeadline(1, 3), "Tougher than it looks");
  assert.equal(scoreHeadline(1, 0), "");
  assert.equal(scoreHeadline(NaN, 5), "");
});

test("answersText: singular and plural", () => {
  assert.equal(answersText(1), "1 answer");
  assert.equal(answersText(0), "0 answers");
  assert.equal(answersText(3), "3 answers");
});

test("sidesOf: which logo won and which the user picked", () => {
  const round = { left: { key: "A" }, right: { key: "B" }, winnerKey: "B", pickedKey: "A" };
  assert.deepEqual(sidesOf(round), { winner: "right", picked: "left" });
  assert.deepEqual(sidesOf({ ...round, pickedKey: "B" }), { winner: "right", picked: "right" });
  assert.deepEqual(sidesOf({ ...round, pickedKey: "Z" }), { winner: "right", picked: null });
});
