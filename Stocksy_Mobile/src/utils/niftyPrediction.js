/**
 * Pure helpers for the daily Nifty prediction card. No React, react-native or
 * network here, so `node --test` can run them.
 *
 * The server owns the rules (when the window is open, who won). This file only
 * decides what the card should SHOW, and keeps the countdown honest between
 * server refreshes.
 */

export const DIRECTION = Object.freeze({ UP: "UP", DOWN: "DOWN" });

// How far the thumb has to travel (0..1 of one side) to count as a call. Past
// this on release it locks in; short of it, it springs back to the middle.
export const COMMIT_THRESHOLD = 0.72;

/** Which way the thumb is leaning, for a drag position of -1 (all the way left) .. +1 (right). */
export function directionFromProgress(progress) {
  if (!Number.isFinite(progress)) return null;
  if (progress >= COMMIT_THRESHOLD) return DIRECTION.UP;
  if (progress <= -COMMIT_THRESHOLD) return DIRECTION.DOWN;
  return null;
}

/** Clamp a drag distance to the track and turn it into -1..+1. */
export function toProgress(dx, maxTravel) {
  if (!Number.isFinite(dx) || !(maxTravel > 0)) return 0;
  return Math.max(-1, Math.min(1, dx / maxTravel));
}

/** "2h 14m", "14m 05s", "45s", "" once it has passed. */
export function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

const ms = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/**
 * The phase to show at `nowMs`. The server's phase is a snapshot; this moves it
 * forward as the clock passes the window times, so the card flips from "open" to
 * "locked" (or "locked in" to "settling") on time, without waiting for a refetch.
 * It only ever moves FORWARD, never to a result — a result always comes from the
 * server.
 */
export function effectivePhase(state, nowMs) {
  if (!state) return null;
  const { phase, window: w, enforced } = state;
  if (!enforced || !w) return phase; // dev window / closed day: trust the server

  const opens = ms(w.opensAt);
  const locks = ms(w.locksAt);
  const settles = ms(w.settlesAt);

  if (phase === "BEFORE_OPEN" && opens != null && nowMs >= opens) {
    return locks != null && nowMs >= locks ? "LOCKED" : "OPEN";
  }
  if (phase === "OPEN" && locks != null && nowMs >= locks) return "LOCKED";
  if (phase === "PREDICTED" && settles != null && nowMs >= settles) return "SETTLING";
  return phase;
}

/** The next window time after `nowMs` worth refetching at, or null. */
export function nextBoundaryMs(state, nowMs) {
  const w = state && state.enforced && state.window;
  if (!w) return null;
  const times = [w.opensAt, w.locksAt, w.settlesAt].map(ms).filter((t) => t != null && t > nowMs);
  return times.length ? Math.min(...times) : null;
}

/** Milliseconds until the time this phase is counting down to, or null. */
export function countdownTarget(state, phase) {
  const w = state && state.window;
  if (!w) return null;
  if (phase === "BEFORE_OPEN") return ms(w.opensAt);
  if (phase === "OPEN") return ms(w.locksAt);
  if (phase === "PREDICTED") return ms(w.settlesAt);
  return null;
}

const SIDE = {
  UP: { word: "Bullish", arrow: "▲" },
  DOWN: { word: "Bearish", arrow: "▼" },
};

/**
 * All the words on the card for a phase.
 *   tone: "idle" | "live" | "win" | "loss" | "flat" | "muted"
 *   canSlide: whether the thumb can be dragged
 */
export function getCardCopy({ state, phase, remainingMs = null }) {
  const prediction = state && state.prediction;
  const side = prediction && SIDE[prediction.direction];
  const lock = (state && state.lockLabel) || "10:00 AM";
  const close = (state && state.closeLabel) || "3:30 PM";
  const left = formatCountdown(remainingMs);

  switch (phase) {
    case "OPEN":
      return {
        eyebrow: "DAILY CHALLENGE",
        title: "Where's Nifty heading today?",
        subtitle: "Slide to lock in your call. No take-backs.",
        hint: left ? `Locks in ${left}` : `Locks at ${lock}`,
        tone: "live",
        canSlide: true,
      };
    case "BEFORE_OPEN":
      return {
        eyebrow: "DAILY CHALLENGE",
        title: "Opening bell soon",
        subtitle: "Calls open with the market at 9:15 AM.",
        hint: left ? `Opens in ${left}` : "Opens at 9:15 AM",
        tone: "muted",
        canSlide: false,
      };
    case "CLOSED_DAY":
      return {
        eyebrow: "DAILY CHALLENGE",
        title: "Markets are resting",
        subtitle: "Your next call opens on the next trading day.",
        hint: "No session today",
        tone: "muted",
        canSlide: false,
      };
    case "LOCKED":
      return {
        eyebrow: "DAILY CHALLENGE",
        title: "Today's window has closed",
        subtitle: `Calls lock at ${lock}. Catch tomorrow's open.`,
        hint: "See you tomorrow",
        tone: "muted",
        canSlide: false,
      };
    case "PREDICTED":
      return {
        eyebrow: "LOCKED IN",
        title: side ? `You're ${side.word.toLowerCase()} ${side.arrow}` : "Call locked in",
        subtitle: `Result at ${close}. Fingers crossed.`,
        hint: left ? `Result in ${left}` : `Result at ${close}`,
        tone: "live",
        canSlide: false,
      };
    case "SETTLING":
      return {
        eyebrow: "LOCKED IN",
        title: "Calling the close…",
        subtitle: "The market has closed. Your result is on its way.",
        hint: "Settling",
        tone: "live",
        canSlide: false,
      };
    case "RESOLVED": {
      const status = prediction && prediction.status;
      const closeText =
        prediction && prediction.closePrice != null
          ? `Nifty closed at ${Number(prediction.closePrice).toLocaleString("en-IN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}.`
          : "";
      if (status === "WON") {
        return {
          eyebrow: "RESULT",
          title: "You called it! 🎯",
          subtitle: `${closeText} Your streak just grew.`.trim(),
          hint: "Back tomorrow at 9:15 AM",
          tone: "win",
          canSlide: false,
        };
      }
      if (status === "LOST") {
        return {
          eyebrow: "RESULT",
          title: "Not today",
          subtitle: `${closeText} Shake it off and call tomorrow.`.trim(),
          hint: "Back tomorrow at 9:15 AM",
          tone: "loss",
          canSlide: false,
        };
      }
      return {
        eyebrow: "RESULT",
        title: "Flat close — no result",
        subtitle: "Nifty finished right where it started, so nobody wins or loses.",
        hint: "Back tomorrow at 9:15 AM",
        tone: "flat",
        canSlide: false,
      };
    }
    default:
      return {
        eyebrow: "DAILY CHALLENGE",
        title: "Where's Nifty heading today?",
        subtitle: "Loading today's call…",
        hint: "",
        tone: "muted",
        canSlide: false,
      };
  }
}

/** The line next to the flame. */
export function getStreakLabel(streak) {
  const current = (streak && streak.current) || 0;
  const played = ((streak && streak.won) || 0) + ((streak && streak.lost) || 0);
  if (current > 0) return `${current} correct in a row`;
  if (played === 0) return "Start your streak";
  return "Streak reset";
}
