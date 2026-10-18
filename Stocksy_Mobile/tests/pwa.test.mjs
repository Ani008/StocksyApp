import test from "node:test";
import assert from "node:assert/strict";
import {
  INSTALL_MODE,
  INSTALL_SNOOZE_MS,
  UPDATE_SNOOZE_MS,
  getInstallMode,
  isAndroidDevice,
  isIosDevice,
  isSnoozed,
  isStandaloneDisplay,
  parseDebugFlag,
} from "../src/utils/pwa.js";
import { computeBuildId, stampServiceWorker } from "../scripts/stamp-sw.mjs";

// ── iOS detection ───────────────────────────────────────────────────────────
test("iPhone and iPod user agents are iOS", () => {
  assert.equal(isIosDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }), true);
  assert.equal(isIosDevice({ userAgent: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0)" }), true);
});

test("iPad reporting a Mac user agent is iOS only when it has a touch screen", () => {
  const macUa = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
  assert.equal(isIosDevice({ userAgent: macUa, platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isIosDevice({ userAgent: macUa, platform: "MacIntel", maxTouchPoints: 0 }), false);
});

test("isAndroidDevice: Android phones yes, iPhone / desktop / empty no", () => {
  assert.equal(isAndroidDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile Safari/537.36" }), true);
  assert.equal(isAndroidDevice({ userAgent: "Mozilla/5.0 (Linux; Android 13; Redmi Note 11) SamsungBrowser/24.0" }), true);
  assert.equal(isAndroidDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }), false);
  assert.equal(isAndroidDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126" }), false);
  assert.equal(isAndroidDevice(), false);
});

test("Android and desktop are not iOS", () => {
  assert.equal(isIosDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)", platform: "Linux armv8l", maxTouchPoints: 5 }), false);
  assert.equal(isIosDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32" }), false);
  assert.equal(isIosDevice(), false);
});

// ── standalone detection ────────────────────────────────────────────────────
test("standalone is true for display-mode OR iOS navigator.standalone", () => {
  assert.equal(isStandaloneDisplay({ displayModeStandalone: true }), true);
  assert.equal(isStandaloneDisplay({ navigatorStandalone: true }), true);
  assert.equal(isStandaloneDisplay({}), false);
  assert.equal(isStandaloneDisplay(), false);
});

// ── install mode ────────────────────────────────────────────────────────────
const base = { isStandalone: false, installed: false, hasNativePrompt: false, isIos: false };

test("native prompt available → native mode", () => {
  assert.equal(getInstallMode({ ...base, hasNativePrompt: true }), INSTALL_MODE.NATIVE);
});

test("iOS without install API → iOS instructions", () => {
  assert.equal(getInstallMode({ ...base, isIos: true }), INSTALL_MODE.IOS);
});

test("already installed or running standalone → never offer install", () => {
  assert.equal(getInstallMode({ ...base, isStandalone: true, hasNativePrompt: true }), INSTALL_MODE.NONE);
  assert.equal(getInstallMode({ ...base, isStandalone: true, isIos: true }), INSTALL_MODE.NONE);
  assert.equal(getInstallMode({ ...base, installed: true, hasNativePrompt: true }), INSTALL_MODE.NONE);
});

test("browsers with no way to install (e.g. desktop Safari/Firefox) → nothing", () => {
  assert.equal(getInstallMode(base), INSTALL_MODE.NONE);
});

// ── snooze ──────────────────────────────────────────────────────────────────
test("snooze window", () => {
  const now = 1_000_000_000_000;
  assert.equal(isSnoozed(now - 1000, now, INSTALL_SNOOZE_MS), true);
  assert.equal(isSnoozed(now - INSTALL_SNOOZE_MS + 1, now, INSTALL_SNOOZE_MS), true);
  assert.equal(isSnoozed(now - INSTALL_SNOOZE_MS, now, INSTALL_SNOOZE_MS), false);
  assert.equal(isSnoozed(now - UPDATE_SNOOZE_MS - 1, now, UPDATE_SNOOZE_MS), false);
});

test("snooze ignores missing, garbage and future timestamps", () => {
  const now = 1_000_000_000_000;
  assert.equal(isSnoozed(null, now, INSTALL_SNOOZE_MS), false);
  assert.equal(isSnoozed(undefined, now, INSTALL_SNOOZE_MS), false);
  assert.equal(isSnoozed("abc", now, INSTALL_SNOOZE_MS), false);
  assert.equal(isSnoozed(0, now, INSTALL_SNOOZE_MS), false);
  assert.equal(isSnoozed(now + 5000, now, INSTALL_SNOOZE_MS), false);
});

test("update is only snoozed for minutes, install for days", () => {
  assert.ok(UPDATE_SNOOZE_MS < 60 * 60 * 1000);
  assert.ok(INSTALL_SNOOZE_MS >= 24 * 60 * 60 * 1000);
});

// ── debug flag ──────────────────────────────────────────────────────────────
test("debug flag parses known values only when enabled", () => {
  assert.equal(parseDebugFlag("?pwa=update", true), "update");
  assert.equal(parseDebugFlag("?a=1&pwa=ios", true), "ios");
  assert.equal(parseDebugFlag("?pwa=INSTALL", true), "install");
  assert.equal(parseDebugFlag("?pwa=bogus", true), null);
  assert.equal(parseDebugFlag("", true), null);
  assert.equal(parseDebugFlag("?pwa=update", false), null);
  assert.equal(parseDebugFlag(undefined, true), null);
});

// ── service-worker stamping ─────────────────────────────────────────────────
test("build id changes when the exported html (bundle hash) changes", () => {
  const a = computeBuildId('<script src="/_expo/static/js/web/index-aaa.js">');
  const b = computeBuildId('<script src="/_expo/static/js/web/index-bbb.js">');
  assert.notEqual(a, b);
  assert.equal(a, computeBuildId('<script src="/_expo/static/js/web/index-aaa.js">'));
  assert.match(a, /^[0-9a-f]{12}$/);
});

test("stamping replaces the placeholder and refuses to run twice", () => {
  const src = 'const BUILD_ID = "__BUILD_ID__";';
  const out = stampServiceWorker(src, "abc123def456");
  assert.equal(out, 'const BUILD_ID = "abc123def456";');
  assert.throws(() => stampServiceWorker(out, "zzz"), /already stamped/);
});
