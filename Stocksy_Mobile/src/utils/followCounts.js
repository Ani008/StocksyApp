// src/utils/followCounts.js
//
// Helpers for the followers / following numbers on the Profile header.
// No React, no network — kept apart so tests/followCounts.test.mjs can check them.

// Anything that isn't a whole number >= 0 (missing, null, NaN, a string, a
// negative) counts as 0, so the header never shows "undefined" or "NaN".
export const safeCount = (value) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

// Instagram-style short form: 0, 12, 999, 1,000 → "1K", 1,250 → "1.2K",
// 12,500 → "12.5K", 1,000,000 → "1M". Rounds DOWN, so a count never
// reads higher than it really is (1,999 is "1.9K", not "2K").
export const formatCount = (value) => {
  const n = safeCount(value);
  if (n < 1000) return String(n);

  const [divisor, suffix] = n >= 1_000_000 ? [1_000_000, "M"] : [1000, "K"];
  const short = Math.floor((n / divisor) * 10) / 10; // one decimal, rounded down
  return `${Number.isInteger(short) ? short : short.toFixed(1)}${suffix}`;
};

// Screen-reader text: "1 follower", "0 followers", "1 following".
export const followersLabel = (count) => {
  const n = safeCount(count);
  return `${n} ${n === 1 ? "follower" : "followers"}`;
};
export const followingLabel = (count) => `${safeCount(count)} following`;
