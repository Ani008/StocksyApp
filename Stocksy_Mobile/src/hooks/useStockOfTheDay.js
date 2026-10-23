import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  getStockOfTheDayToday,
  submitStockOfTheDayAnswer,
} from "../../services/stockOfTheDayService";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * State and actions for the Stock of the Day game.
 *
 * The server owns everything that matters: which rounds today has, which
 * company really won, and the score. This hook only keeps the screen current:
 *   - loads today's state, and reloads when the app comes back to the
 *     foreground (the IST day may have rolled over while it was in the
 *     background);
 *   - `answer()` locks in one pick, holding the screen on the chosen logo for a
 *     beat so the tap registers, then moves to the server's new state.
 *
 * `state` is null until the first load. `failed` is only set when there is
 * nothing to show, so a flaky refresh never wipes a game in progress.
 */
export default function useStockOfTheDay() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const mounted = useRef(true);
  const inFlight = useRef(false);
  const submitLock = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await getStockOfTheDayToday();
      if (mounted.current) {
        setState(next);
        setFailed(false);
      }
    } catch {
      // The interceptor already toasted. Keep whatever we had.
      if (mounted.current) setFailed(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Back in the app (or browser tab): the day may have moved on.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && !submitLock.current) load();
    });
    return () => sub.remove();
  }, [load]);

  /**
   * Lock in an answer. Resolves to true if it went through. A second tap while
   * one is in flight is ignored.
   */
  const answer = useCallback(async (roundIndex, pickedKey, { holdMs = 450 } = {}) => {
    if (submitLock.current) return false;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const [next] = await Promise.all([submitStockOfTheDayAnswer(roundIndex, pickedKey), sleep(holdMs)]);
      if (mounted.current) {
        setState(next);
        setFailed(false);
      }
      return true;
    } catch {
      return false; // the interceptor already toasted; the same round stays open
    } finally {
      submitLock.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }, []);

  return { state, loading, failed, submitting, reload: load, answer };
}
