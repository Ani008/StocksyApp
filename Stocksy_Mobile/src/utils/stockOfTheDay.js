/**
 * Pure helpers for the Stock of the Day result screen. No React, react-native
 * or network here, so `node --test` can run them.
 *
 * The server decides who won and sends the raw numbers; this file only decides
 * how to WRITE them (units, Indian digit grouping) and what to say about a score.
 */

/** 318556 -> "3,18,556" (Indian grouping: last three digits, then pairs). */
export function groupIndian(n) {
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.round(Math.abs(n)));
  if (digits.length <= 3) return sign + digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${sign}${rest},${last3}`;
}

/**
 * Write a compared number for people.
 *   unit "inr_cr"  market value in crore rupees -> "₹3,18,556 Cr", or
 *                  "₹5.16 lakh Cr" from one lakh crore up
 *   unit "pct"     -> "31.3%"   (pass signed: true for growth -> "+10.2%")
 *   unit "x"       -> "37.3x"
 *   unit "year"    -> "1968"    (a founding year: no commas, no decimals)
 * Anything that is not a finite number is "N/A" (never "NaN").
 */
export function formatValue(unit, value, { signed = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";

  if (unit === "inr_cr") {
    if (value >= 100000) return `₹${(value / 100000).toFixed(2)} lakh Cr`;
    return `₹${groupIndian(value)} Cr`;
  }
  if (unit === "pct") {
    const text = Math.abs(value).toFixed(1);
    // -0.04 rounds to "0.0": show no sign rather than "-0.0%".
    const isZero = Number(text) === 0;
    const sign = value < 0 && !isZero ? "-" : signed && value > 0 && !isZero ? "+" : "";
    return `${sign}${text}%`;
  }
  if (unit === "x") return `${value.toFixed(value >= 100 ? 0 : 1)}x`;
  if (unit === "year") return String(Math.round(value));
  return String(value);
}

/** Growth numbers read better with an explicit +/- sign. */
export const isGrowthLabel = (label) => /growth/i.test(label || "");

/** The line shown above the score. Plain and honest, no scoring beyond right/wrong. */
export function scoreHeadline(score, total) {
  if (!(total > 0) || !Number.isFinite(score)) return "";
  if (score === total) return "Perfect score!";
  if (score === 0) return "Tough day. Tomorrow's a new sector.";
  if (score >= Math.ceil(total * 0.6)) return "Nice one!";
  return "Tougher than it looks";
}

/** "1 answer" / "3 answers" */
export const answersText = (n) => `${n} ${n === 1 ? "answer" : "answers"}`;

/** Which side of a result round the user picked and which won: "left" | "right". */
export function sidesOf(round) {
  const side = (key) => (key === round.left.key ? "left" : key === round.right.key ? "right" : null);
  return { winner: side(round.winnerKey), picked: side(round.pickedKey) };
}

/**
 * The short word on a result round's category card ("AGE", "SALES", ...), taken
 * from the label the server sends. An unknown label is shown as is, in capitals.
 */
const CATEGORY_WORDS = {
  founded: "AGE",
  "sales growth": "SALES",
  "market value": "VALUATION",
  "profit margin": "MARGIN",
  "yearly profit": "PROFIT",
};
export const categoryWord = (label) => {
  const text = String(label || "").trim();
  return CATEGORY_WORDS[text.toLowerCase()] || text.toUpperCase();
};

/** Font size that keeps a compared number on one line inside a result card. */
export function valueFontSize(text) {
  const n = String(text || "").length;
  if (n <= 6) return 24;
  if (n <= 9) return 19;
  if (n <= 11) return 16;
  return 14;
}
