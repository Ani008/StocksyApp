import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  EMPTY_STREAK,
  applyCheckIn,
  effectiveStreak,
  getStreakMessage,
  getWeek,
  sanitizeState,
  toDateKey,
} from "../utils/streak";

const KEY_PREFIX = "stocksy.streak.v1.";

// Streaks are kept per account so two people sharing a device don't share one.
// Logging out clears "user" but not this key, so a streak survives a re-login.
async function resolveStorageKey() {
  try {
    const raw = await AsyncStorage.getItem("user");
    const user = raw ? JSON.parse(raw) : null;
    const id = user?.id ?? user?.email ?? user?.username;
    return `${KEY_PREFIX}${id ?? "guest"}`;
  } catch {
    return `${KEY_PREFIX}guest`;
  }
}

/**
 * Daily streak for the signed-in user.
 *
 * Opening the app counts as the day's check-in. The check-in runs on mount,
 * whenever the app returns to the foreground on a new day, and when the
 * caller invokes `recheck` (the dashboard does so on screen focus, because tab
 * screens stay mounted across midnight).
 *
 * `readOnly` is for screens that only display the streak (Profile): it reads
 * what is saved and never records a check-in. Only the Home screen records
 * one, so the "Day N" welcome there can't be used up by another screen.
 *
 * Today this lives on the device only. It is lost on reinstall and follows the
 * phone's clock; moving it to the server is the follow-up.
 */
export default function useStreak({ readOnly = false } = {}) {
  const [state, setState] = useState(EMPTY_STREAK);
  const [today, setToday] = useState(() => toDateKey());
  const [loading, setLoading] = useState(true);
  // Set only when *this* session recorded a new day, so the UI can celebrate
  // once and not on every re-render or revisit.
  const [event, setEvent] = useState({ dayKey: null, lostStreak: 0, milestone: 0 });

  const storageKey = useRef(null);
  const stateRef = useRef(EMPTY_STREAK);
  const busy = useRef(false);

  const recheck = useCallback(async () => {
    if (busy.current) return; // a check-in is already running
    busy.current = true;
    try {
      if (!storageKey.current) storageKey.current = await resolveStorageKey();

      if (readOnly) {
        // Always re-read: another screen may have recorded a day since.
        let latest;
        try {
          const raw = await AsyncStorage.getItem(storageKey.current);
          latest = sanitizeState(raw ? JSON.parse(raw) : null);
        } catch {
          latest = sanitizeState(null);
        }
        stateRef.current = latest;
        setState(latest);
        setToday(toDateKey());
        return;
      }

      let saved = stateRef.current;
      if (saved === EMPTY_STREAK) {
        try {
          const raw = await AsyncStorage.getItem(storageKey.current);
          saved = sanitizeState(raw ? JSON.parse(raw) : null);
        } catch {
          saved = sanitizeState(null);
        }
      }

      const todayKey = toDateKey();
      const result = applyCheckIn(saved, todayKey);

      stateRef.current = result.state;
      setState(result.state);
      setToday(todayKey);

      if (result.isNewDay) {
        setEvent({
          dayKey: todayKey,
          lostStreak: result.lostStreak,
          milestone: result.milestone,
        });
        try {
          await AsyncStorage.setItem(storageKey.current, JSON.stringify(result.state));
        } catch (err) {
          // The streak still shows for this session; it just won't survive a restart.
          console.warn("Could not save streak", err);
        }
      }
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [readOnly]);

  useEffect(() => {
    recheck();
  }, [recheck]);

  // Coming back to the app (or its browser tab) after midnight is a new day.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && toDateKey() !== today) recheck();
    });
    return () => sub.remove();
  }, [recheck, today]);

  const current = effectiveStreak(state, today);
  const week = useMemo(() => getWeek(today, state.history), [today, state.history]);
  const message = useMemo(
    () =>
      getStreakMessage({
        current,
        lostStreak: event.lostStreak,
        milestone: event.milestone,
      }),
    [current, event.lostStreak, event.milestone],
  );

  return {
    loading,
    streak: current,
    longest: Math.max(state.longest, current),
    week,
    message,
    // Set to that day's key when this session recorded a new day. A new key
    // per day lets the UI celebrate each day once, even if the app stays open.
    celebrateKey: event.dayKey,
    celebrate: event.dayKey !== null,
    milestone: event.milestone,
    recheck,
  };
}
