import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { checkInStreak, getStreak } from "../../services/streakService";
import {
  EMPTY_STREAK,
  effectiveStreak,
  getStreakMessage,
  getWeek,
  milestoneFor,
  sanitizeState,
  toIstDateKey,
} from "../utils/streak";

// The device keeps a COPY of the streak, per account: it makes the screens show
// instantly and keeps something on screen when the phone is offline. The truth
// is on the server. Before the server kept streaks, this key WAS the streak, so
// whatever is in it on first sync is offered to the server once (see below).
const CACHE_PREFIX = "stocksy.streak.v1.";
// Set once the server has this account's streak, so the old on-device history
// is offered only once and never again.
const SYNCED_PREFIX = "stocksy.streak.synced.v1.";

// Streaks are kept per account so two people sharing a device don't share one.
// Logging out clears "user" but not these keys, so a re-login shows it at once.
async function resolveKeys() {
  let id = "guest";
  try {
    const raw = await AsyncStorage.getItem("user");
    const user = raw ? JSON.parse(raw) : null;
    id = user?.id ?? user?.email ?? user?.username ?? "guest";
  } catch {
    // fall back to the guest keys
  }
  return { cacheKey: `${CACHE_PREFIX}${id}`, syncedKey: `${SYNCED_PREFIX}${id}` };
}

async function readCache(cacheKey) {
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    return sanitizeState(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeState(null);
  }
}

async function readSynced(syncedKey) {
  try {
    return (await AsyncStorage.getItem(syncedKey)) === "1";
  } catch {
    return false;
  }
}

// What the server sends back, as the app's streak state.
const fromServer = (res) =>
  sanitizeState({
    current: res?.current,
    longest: res?.longest,
    lastCheckIn: res?.lastCheckIn,
    history: res?.history,
  });

/**
 * Daily streak for the signed-in user.
 *
 * Opening the app counts as the day's check-in, and the SERVER keeps the
 * streak: it survives a reinstall, a new device, a new web address or cleared
 * browser data, and a wrong phone clock can't change it. The check-in runs on
 * mount, whenever the app returns to the foreground, and when the caller
 * invokes `recheck` (the dashboard does so on screen focus, because tab
 * screens stay mounted across midnight). Once today is counted on this device
 * it costs nothing to call again.
 *
 * Days are IST calendar days (the exchange's day, and what the server counts),
 * whatever timezone the phone is in.
 *
 * If the server can't be reached the last streak this device saw stays on
 * screen and the next recheck tries again. A day is counted when the app next
 * reaches the server, so a day spent entirely offline is not counted.
 *
 * `readOnly` is for screens that only display the streak (Profile): it never
 * records a check-in. Only the Home screen records one, so the "Day N" welcome
 * there can't be used up by another screen.
 */
export default function useStreak({ readOnly = false } = {}) {
  const [state, setState] = useState(EMPTY_STREAK);
  const [today, setToday] = useState(() => toIstDateKey());
  const [loading, setLoading] = useState(true);
  // Set only when *this* session recorded a new day, so the UI can celebrate
  // once and not on every re-render or revisit.
  const [event, setEvent] = useState({ dayKey: null, lostStreak: 0, milestone: 0 });

  const keys = useRef(null);
  const stateRef = useRef(EMPTY_STREAK);
  const busy = useRef(false);

  const show = useCallback((next) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Keep a copy on the device. A failure here only costs the instant display.
  const saveCache = useCallback(async (next, markSynced) => {
    try {
      await AsyncStorage.setItem(keys.current.cacheKey, JSON.stringify(next));
      if (markSynced) await AsyncStorage.setItem(keys.current.syncedKey, "1");
    } catch (err) {
      console.warn("Could not save streak", err);
    }
  }, []);

  const recheck = useCallback(async () => {
    if (busy.current) return; // a check-in is already running
    busy.current = true;
    try {
      if (!keys.current) keys.current = await resolveKeys();
      const { cacheKey, syncedKey } = keys.current;
      const todayKey = toIstDateKey();

      // What this device already knows: shows straight away, and is what stays
      // on screen if the server can't be reached.
      const cached = readOnly || stateRef.current === EMPTY_STREAK
        ? await readCache(cacheKey)
        : stateRef.current;
      show(cached);
      setToday(todayKey);
      setLoading(false);

      const synced = await readSynced(syncedKey);

      if (readOnly) {
        // Display only. Normally the copy is current, because Home records the
        // day. A fresh install that opens this screen first has nothing yet, so
        // ask the server (this reads only; it records no day).
        if (!synced && cached.lastCheckIn === null) {
          try {
            const fresh = fromServer(await getStreak());
            show(fresh);
            await saveCache(fresh, false);
          } catch {
            // offline: show the empty state; Home will sync soon
          }
        }
        return;
      }

      // Already counted today on this device and the server has it: nothing to ask.
      if (synced && cached.lastCheckIn === todayKey) return;

      let res;
      try {
        // First sync only: also offer the streak this device had saved before
        // the server kept it, so an existing streak isn't lost.
        res = await checkInStreak(synced ? undefined : cached.history);
      } catch {
        // Offline or a server hiccup: keep what is on screen. The next recheck
        // (focus, foreground) tries again.
        return;
      }

      const next = fromServer(res);
      show(next);
      setToday(res?.today || todayKey);

      if (res?.isNewDay) {
        setEvent({
          dayKey: res.today || todayKey,
          lostStreak: res.lostStreak || 0,
          milestone: milestoneFor(next.current),
        });
      }
      await saveCache(next, true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [readOnly, show, saveCache]);

  useEffect(() => {
    recheck();
  }, [recheck]);

  // Coming back to the app (or its browser tab) is a chance to count a new day
  // or to retry a check-in that failed. When today is already counted, this
  // costs nothing.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") recheck();
    });
    return () => sub.remove();
  }, [recheck]);

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
    history: state.history,
    today,
    message,
    // Set to that day's key when this session recorded a new day. A new key
    // per day lets the UI celebrate each day once, even if the app stays open.
    celebrateKey: event.dayKey,
    celebrate: event.dayKey !== null,
    milestone: event.milestone,
    recheck,
  };
}
