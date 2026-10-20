/**
 * Pure helpers for the paged hero carousel (no React / react-native).
 */

/** Which page is showing for a horizontal scroll offset. Always 0..count-1. */
export function pageFromOffset(offsetX, pageWidth, count) {
  if (!(count > 0)) return 0;
  if (!Number.isFinite(offsetX) || !(pageWidth > 0)) return 0;
  const page = Math.round(offsetX / pageWidth);
  return Math.max(0, Math.min(count - 1, page));
}

/** Scroll offset that puts `page` at the left edge (clamped to a real page). */
export function offsetForPage(page, pageWidth, count) {
  if (!(count > 0) || !(pageWidth > 0)) return 0;
  const p = Math.max(0, Math.min(count - 1, Math.floor(Number.isFinite(page) ? page : 0)));
  return p * pageWidth;
}
