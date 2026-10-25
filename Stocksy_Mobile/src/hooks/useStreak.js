import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { getStreak, importStreakDays } from "../../services/streakService";
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
// The last day the "Day N" welcome was shown for, so it appears once per day
// however many times the app is opened or the screen is revisited.
const CELEBRATED_PREFIX = "stocksy.streak.celebrated.v1.";

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
  return {
    cacheKey: `${CACHE_PREFIX}${id}`,
    syncedKey: `${SYNCED_PREFIX}${id}`,
    celebratedKey: `${CELEBRATED_PREFIX}${id}`,
  };
}

async function readCache(cacheKey) {
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    return sanitizeState(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeState(null);
  }
}

async function readFlag(key) {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Daily streak for the signed-in user.
 *
 * A day counts when the person DOES something on it: makes their daily Nifty
 * call or places a buy / sell order. Just opening the app does not count, so
 * this hook never records anything. The SERVER records the day (when the order
 * or call goes through) and keeps the streak: it survives a reinstall, a new
 * device, a new web address or cleared browser data, and a wrong phone clock
 * can't change it. This hook only READS it.
 *
 * It reads on mount, whenever the app returns to the foreground, and when the
 * caller invokes `recheck` (the dashboard does so on screen focus, which is how
 * a streak earned on the order or Nifty screen shows up when you come back).
 * Once today is counted on this device, rechecking costs nothing.
 *
 * Days are IST calendar days, whatever timezone the phone is in. Streaks run on
 * trading days: weekends and market holidays neither add to nor break one.
 *
 * If the server can't be reached, the last streak this device saw stays on
 * screen and the next recheck tries again.
 *
 * `readOnly` is for screens that only display the streak (Profile, Streaks): it
 * never fires the "Day N" welcome. Only the Home screen does, so the welcome
 * there can't be used up by another screen.
 */
export default function useStreak({ readOnly = false } = {}) {
  const [state, setState] = useState(EMPTY_STREAK);
  const [today, setToday] = useState(() => toIstDateKey());
  const [loading, setLoading] = useState(true);
  // Set only when this session sees that today was earned, so the UI can
  // celebrate once and not on every re-render or revisit.
  const [event, setEvent] = useState({ dayKey: null, lostStreak: 0, milestone: 0 });

  const keys = useRef(null);
  const stateRef = useRef(EMPTY_STREAK);
  const busy = useRef(false);

  const show = useCallback((next) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Keep a copy on the device. A failure here only costs the instant display.
  const save = useCallback(async (key, value) => {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (err) {
      console.warn("Could not save streak", err);
    }
  }, []);

  // The Home screen's "Day N" welcome: once per day, the first time we see that
  // today has been earned.
  const maybeCelebrate = useCallback(
    async (next, todayKey) => {
      if (readOnly || next.lastCheckIn !== todayKey || next.current < 1) return;
      const { celebratedKey } = keys.current;
      if ((await readFlag(celebratedKey)) === todayKey) return;
      await save(celebratedKey, todayKey);
      setEvent({
        dayKey: todayKey,
        lostStreak: next.lostStreak,
        milestone: milestoneFor(next.current),
      });
    },
    [readOnly, save],
  );

  const recheck = useCallback(async () => {
    if (busy.current) return; // a read is already running
    busy.current = true;
    try {
      if (!keys.current) keys.current = await resolveKeys();
      const { cacheKey, syncedKey } = keys.current;
      const todayKey = toIstDateKey();

      // What this device already knows: shows straight away, and is what stays
      // on screen if the server can't be reached.
      const cached = stateRef.current === EMPTY_STREAK ? await readCache(cacheKey) : stateRef.current;
      show(cached);
      setToday(todayKey);
      setLoading(false);

      const synced = (await readFlag(syncedKey)) === "1";

      // Today is already earned and the server has this account: nothing can
      // change until tomorrow, so there is nothing to ask.
      if (synced && cached.lastCheckIn === todayKey) {
        await maybeCelebrate(cached, todayKey);
        return;
      }

      let res;
      try {
        // First sync only: offer the streak this device had saved before the
        // server kept it, so an existing streak isn't lost. The server answers
        // with the streak either way.
        res =
          !synced && cached.history.length > 0
            ? await importStreakDays(cached.history)
            : await getStreak();
      } catch {
        // Offline or a server hiccup: keep what is on screen. The next recheck
        // (focus, foreground) tries again.
        return;
      }

      const next = sanitizeState(res);
      show(next);
      setToday(res?.today || todayKey);

      await save(cacheKey, JSON.stringify(next));
      if (!synced) await save(syncedKey, "1");
      await maybeCelebrate(next, res?.today || todayKey);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [show, save, maybeCelebrate]);

  useEffect(() => {
    recheck();
  }, [recheck]);

  // Coming back to the app (or its browser tab) is a chance to pick up a day
  // earned elsewhere or a new calendar day. When today is already counted this
  // costs nothing.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") recheck();
    });
    return () => sub.remove();
  }, [recheck]);

  const current = effectiveStreak(state, today);
  const week = useMemo(() => getWeek(today, state.history, state.offDays), [today, state.history, state.offDays]);
  // Nothing left to do today if it is already earned, or it is a day off.
  const doneToday = state.lastCheckIn === today || state.offDays.includes(today);
  const message = useMemo(
    () =>
      getStreakMessage({
        current,
        lostStreak: event.lostStreak,
        milestone: event.milestone,
        doneToday,
      }),
    [current, event.lostStreak, event.milestone, doneToday],
  );

  return {
    loading,
    streak: current,
    longest: Math.max(state.longest, current),
    week,
    history: state.history,
    today,
    message,
    // Set to that day's key when this session saw today get earned. A new key
    // per day lets the UI celebrate each day once, even if the app stays open.
    celebrateKey: event.dayKey,
    celebrate: event.dayKey !== null,
    milestone: event.milestone,
    recheck,
  };
}
