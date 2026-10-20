import test from "node:test";
import assert from "node:assert/strict";
import {
  COMMIT_THRESHOLD,
  DIRECTION,
  countdownTarget,
  directionFromProgress,
  effectivePhase,
  formatCountdown,
  getCardCopy,
  getStreakLabel,
  nextBoundaryMs,
  toProgress,
} from "../src/utils/niftyPrediction.js";

const at = (hhmm) => Date.parse(`2026-10-21T${hhmm}:00+05:30`);
const WINDOW = {
  opensAt: "2026-10-21T09:15:00+05:30",
  locksAt: "2026-10-21T10:00:00+05:30",
  settlesAt: "2026-10-21T15:30:00+05:30",
};
const state = (phase, extra = {}) => ({ phase, enforced: true, window: WINDOW, prediction: null, ...extra });

// ── the slide ───────────────────────────────────────────────────────────────
test("drag: only a deliberate slide counts as a call", () => {
  assert.equal(directionFromProgress(0), null);
  assert.equal(directionFromProgress(COMMIT_THRESHOLD - 0.01), null);
  assert.equal(directionFromProgress(-(COMMIT_THRESHOLD - 0.01)), null);
  assert.equal(directionFromProgress(COMMIT_THRESHOLD), DIRECTION.UP);
  assert.equal(directionFromProgress(1), DIRECTION.UP);
  assert.equal(directionFromProgress(-COMMIT_THRESHOLD), DIRECTION.DOWN);
  assert.equal(directionFromProgress(-1), DIRECTION.DOWN);
  assert.equal(directionFromProgress(NaN), null);
  assert.equal(directionFromProgress(undefined), null);
});

test("drag: distance is clamped to the track and safe on bad input", () => {
  assert.equal(toProgress(50, 100), 0.5);
  assert.equal(toProgress(-50, 100), -0.5);
  assert.equal(toProgress(500, 100), 1);
  assert.equal(toProgress(-500, 100), -1);
  assert.equal(toProgress(10, 0), 0, "track not measured yet");
  assert.equal(toProgress(NaN, 100), 0);
});

// ── countdown ───────────────────────────────────────────────────────────────
test("formatCountdown", () => {
  assert.equal(formatCountdown(5 * 3600e3 + 12 * 60e3 + 30e3), "5h 12m");
  assert.equal(formatCountdown(14 * 60e3 + 5e3), "14m 05s");
  assert.equal(formatCountdown(45e3), "45s");
  assert.equal(formatCountdown(500), "1s", "rounds up so it never shows 0s while still counting");
  for (const bad of [0, -1, NaN, null, undefined]) assert.equal(formatCountdown(bad), "", String(bad));
});

// ── phase moves forward with the clock ──────────────────────────────────────
test("effectivePhase: flips on time without a refetch", () => {
  assert.equal(effectivePhase(state("BEFORE_OPEN"), at("09:14")), "BEFORE_OPEN");
  assert.equal(effectivePhase(state("BEFORE_OPEN"), at("09:15")), "OPEN");
  assert.equal(effectivePhase(state("OPEN"), at("09:59")), "OPEN");
  assert.equal(effectivePhase(state("OPEN"), at("10:00")), "LOCKED");
  assert.equal(effectivePhase(state("PREDICTED"), at("15:29")), "PREDICTED");
  assert.equal(effectivePhase(state("PREDICTED"), at("15:30")), "SETTLING");
});

test("effectivePhase: never invents a result, and never undoes one", () => {
  for (const phase of ["RESOLVED", "SETTLING", "LOCKED", "CLOSED_DAY"]) {
    assert.equal(effectivePhase(state(phase), at("23:00")), phase, phase);
  }
  assert.equal(effectivePhase(state("BEFORE_OPEN"), at("12:00")), "LOCKED", "app opened late with stale data");
});

test("effectivePhase: dev mode (not enforced) and missing data trust the server", () => {
  assert.equal(effectivePhase(state("OPEN", { enforced: false }), at("23:00")), "OPEN");
  assert.equal(effectivePhase(state("OPEN", { window: null }), at("23:00")), "OPEN");
  assert.equal(effectivePhase(null, at("10:00")), null);
});

test("nextBoundaryMs: the next window time to refetch at", () => {
  assert.equal(nextBoundaryMs(state("OPEN"), at("09:20")), at("10:00"));
  assert.equal(nextBoundaryMs(state("PREDICTED"), at("10:30")), at("15:30"));
  assert.equal(nextBoundaryMs(state("RESOLVED"), at("16:00")), null);
  assert.equal(nextBoundaryMs(state("OPEN", { enforced: false }), at("09:20")), null);
});

test("countdownTarget: what each phase counts down to", () => {
  assert.equal(countdownTarget(state("BEFORE_OPEN"), "BEFORE_OPEN"), at("09:15"));
  assert.equal(countdownTarget(state("OPEN"), "OPEN"), at("10:00"));
  assert.equal(countdownTarget(state("PREDICTED"), "PREDICTED"), at("15:30"));
  assert.equal(countdownTarget(state("LOCKED"), "LOCKED"), null);
  assert.equal(countdownTarget(state("OPEN", { window: null }), "OPEN"), null);
});

// ── words on the card ───────────────────────────────────────────────────────
test("copy: only OPEN can be slid", () => {
  for (const phase of ["BEFORE_OPEN", "CLOSED_DAY", "LOCKED", "PREDICTED", "SETTLING", "RESOLVED", "nonsense", null]) {
    assert.equal(getCardCopy({ state: state(phase), phase }).canSlide, false, String(phase));
  }
  assert.equal(getCardCopy({ state: state("OPEN"), phase: "OPEN", remainingMs: 60e3 }).canSlide, true);
});

test("copy: open shows the live countdown, falling back to the lock time", () => {
  assert.equal(getCardCopy({ state: state("OPEN"), phase: "OPEN", remainingMs: 42 * 60e3 }).hint, "Locks in 42m 00s");
  assert.equal(getCardCopy({ state: state("OPEN", { lockLabel: "9:45 AM" }), phase: "OPEN" }).hint, "Locks at 9:45 AM");
});

test("copy: a locked-in call names its side", () => {
  const up = getCardCopy({ state: state("PREDICTED", { prediction: { direction: "UP", status: "PENDING" } }), phase: "PREDICTED", remainingMs: 3600e3 });
  assert.match(up.title, /bullish ▲/);
  assert.equal(up.hint, "Result in 1h 00m");
  const down = getCardCopy({ state: state("PREDICTED", { prediction: { direction: "DOWN", status: "PENDING" } }), phase: "PREDICTED" });
  assert.match(down.title, /bearish ▼/);
});

test("copy: results — win, loss and flat have distinct tones; close price is formatted", () => {
  const r = (status) => getCardCopy({
    state: state("RESOLVED", { prediction: { direction: "UP", status, closePrice: 24512.35 } }),
    phase: "RESOLVED",
  });
  assert.equal(r("WON").tone, "win");
  assert.equal(r("LOST").tone, "loss");
  assert.equal(r("VOID").tone, "flat");
  assert.match(r("WON").subtitle, /24,512\.35/);
});

test("copy: an unknown phase or no state is a safe loading card", () => {
  assert.equal(getCardCopy({ state: null, phase: null }).canSlide, false);
  assert.equal(getCardCopy({ state: null, phase: null }).tone, "muted");
});

test("streak label", () => {
  assert.equal(getStreakLabel({ current: 4, won: 4, lost: 0 }), "4 correct in a row");
  assert.equal(getStreakLabel({ current: 0, won: 0, lost: 0 }), "Start your streak");
  assert.equal(getStreakLabel({ current: 0, won: 3, lost: 1 }), "Streak reset");
  assert.equal(getStreakLabel(undefined), "Start your streak");
});
