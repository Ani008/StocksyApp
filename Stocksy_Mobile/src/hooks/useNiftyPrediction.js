import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { getNiftyToday, submitNiftyPrediction } from "../../services/predictionService";
import {
  countdownTarget,
  effectivePhase,
  nextBoundaryMs,
} from "../utils/niftyPrediction";

// While a result is being worked out, ask again this often.
const SETTLING_POLL_MS = 20 * 1000;
// Wait a beat past a boundary so the server has certainly crossed it too.
const BOUNDARY_GRACE_MS = 1500;
// setTimeout overflows past ~24.8 days; we never need anywhere near that.
const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/**
 * State and actions for the daily Nifty prediction card.
 *
 * The server decides everything that matters (is the window open, who won).
 * This hook keeps what's on screen current between server answers:
 *   - `phase` moves forward with the clock (open -> locked, locked-in ->
 *     settling) using the SERVER's time, so a wrong phone clock can't make the
 *     card show a window that is really shut;
 *   - it refetches when a window boundary passes, while a result is pending,
 *     and when the app returns to the foreground.
 *
 * Used inside the card itself so the once-a-second countdown re-renders only
 * the card, not the whole dashboard.
 */
export default function useNiftyPrediction() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // serverTime - deviceTime, measured when the state arrived.
  const skewMs = useRef(0);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const submitLock = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback((next) => {
    const server = Date.parse(next && next.serverTime);
    skewMs.current = Number.isFinite(server) ? server - Date.now() : 0;
    setState(next);
    setFailed(false);
    setNowMs(Date.now() + skewMs.current);
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await getNiftyToday();
      if (mounted.current) apply(next);
    } catch {
      // The interceptor already toasted. Keep showing whatever we had; only
      // flag a failure when there is nothing to show.
      if (mounted.current) setFailed(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    load();
  }, [load]);

  // Back in the app (or browser tab): the day may have moved on.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") load();
    });
    return () => sub.remove();
  }, [load]);

  const phase = useMemo(() => effectivePhase(state, nowMs), [state, nowMs]);
  const target = useMemo(() => countdownTarget(state, phase), [state, phase]);
  const remainingMs = target == null ? null : Math.max(0, target - nowMs);

  // Tick once a second, but only while there is a countdown to show.
  const ticking = target != null;
  useEffect(() => {
    if (!ticking) return undefined;
    const id = setInterval(() => setNowMs(Date.now() + skewMs.current), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  // Refetch just after the next window boundary, and keep asking while a
  // result is pending.
  useEffect(() => {
    if (!state) return undefined;
    const base = Date.now() + skewMs.current;

    if (phase === "SETTLING") {
      const id = setInterval(load, SETTLING_POLL_MS);
      return () => clearInterval(id);
    }
    const boundary = nextBoundaryMs(state, base);
    if (boundary == null) return undefined;
    const wait = Math.min(Math.max(boundary - base, 0) + BOUNDARY_GRACE_MS, MAX_TIMEOUT_MS);
    const id = setTimeout(load, wait);
    return () => clearTimeout(id);
  }, [state, phase, load]);

  /**
   * Lock in a call. Resolves true if the call is now in (made just now or
   * already made), false if it was refused. On a refusal the interceptor has
   * toasted the reason; we refetch so the card shows the truth (e.g. the
   * window just locked).
   */
  const submit = useCallback(
    async (direction) => {
      if (submitLock.current) return false; // one request at a time
      submitLock.current = true;
      setSubmitting(true);
      try {
        const next = await submitNiftyPrediction(direction);
        if (mounted.current) apply(next);
        return true;
      } catch {
        if (mounted.current) await load();
        return false;
      } finally {
        submitLock.current = false;
        if (mounted.current) setSubmitting(false);
      }
    },
    [apply, load],
  );

  return {
    state,
    phase,
    loading,
    failed,
    submitting,
    remainingMs,
    streak: state ? state.streak : null,
    prediction: state ? state.prediction : null,
    submit,
    reload: load,
  };
}
