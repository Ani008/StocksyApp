import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import * as Application from "expo-application";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { API_BASE_URL } from "../config/env";
import { fetchAppVersionInfo } from "../../services/appVersionService";
import { openPlayStore } from "../utils/openPlayStore";
import {
  UPDATE_STATUS,
  getUpdateStatus,
  isDismissed,
  parseBuildNumber,
  parseVersionPayload,
} from "../utils/appUpdate";
import {
  DISMISS_DURATION_MS,
  ENABLE_IN_DEV,
  FAILED_ATTEMPT_BACKOFF_MS,
  FALLBACK_BODY,
  FAST_TEST_MODE,
  FAST_TEST_POLL_MS,
  GENERIC_SERVER_MESSAGES,
  STORAGE_KEY_DISMISSED,
  STORAGE_KEY_SERVER_INFO,
  VERSION_CHECK_INTERVAL_MS,
} from "../config/appUpdate";

const AppUpdateContext = createContext({
  status: UPDATE_STATUS.NONE,
  showBanner: false,
  body: FALLBACK_BODY,
  dismiss: () => {},
  openStore: async () => false,
});

const log = (...args) => console.log("[appUpdate]", ...args);

export function AppUpdateProvider({ children }) {
  // The update check is Android-only (the Play Store build number is what we
  // compare). In fast-test mode (dev + EXPO_PUBLIC_ENABLE_UPDATE_CHECK_IN_DEV)
  // it also runs on iOS so the banner UI can be tested in Expo Go on an iPhone.
  // __DEV__ is false in release builds, so iOS users are never affected.
  const isSupportedPlatform = Platform.OS === "android" || FAST_TEST_MODE;
  const enabled = isSupportedPlatform && (!__DEV__ || ENABLE_IN_DEV);

  const currentBuild = useMemo(() => {
    if (!isSupportedPlatform) return null;
    // Dev-only override so the update UI can be tested in Expo Go.
    // __DEV__ is false in release builds, so this can never affect users.
    const fake = __DEV__
      ? parseBuildNumber(process.env.EXPO_PUBLIC_FAKE_BUILD_NUMBER)
      : null;
    return fake ?? parseBuildNumber(Application.nativeBuildVersion);
  }, [isSupportedPlatform]);

  // Step 1: what does this build think its configuration is?
  useEffect(() => {
    log("1/5 config", {
      platform: Platform.OS,
      __DEV__,
      ENABLE_IN_DEV,
      FAST_TEST_MODE,
      enabled,
      currentBuild,
      fakeBuildEnv: process.env.EXPO_PUBLIC_FAKE_BUILD_NUMBER,
      nativeBuildVersion: Application.nativeBuildVersion,
      intervalMs: VERSION_CHECK_INTERVAL_MS,
      apiBase: API_BASE_URL,
    });
    if (!enabled) {
      log(
        "DISABLED. Update check will NOT run. Reasons:",
        !isSupportedPlatform ? "platform not supported (need android, or fast-test mode on iOS)" : "",
        __DEV__ && !ENABLE_IN_DEV ? "EXPO_PUBLIC_ENABLE_UPDATE_CHECK_IN_DEV is not 'true' in this bundle (check .env + npx expo start -c)" : "",
      );
    }
    if (enabled && currentBuild === null) {
      log("WARNING: currentBuild is null, so no banner can ever show. Set EXPO_PUBLIC_FAKE_BUILD_NUMBER.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [info, setInfo] = useState(null);
  const [dismissed, setDismissed] = useState(null);

  const lastSuccessRef = useRef(0);
  const lastAttemptRef = useRef(0);
  const inFlightRef = useRef(false);

  const checkForUpdate = useCallback(async () => {
    if (!enabled) return;
    if (inFlightRef.current) {
      log("2/5 check skipped: request already in flight");
      return;
    }
    const now = Date.now();
    if (now - lastSuccessRef.current < VERSION_CHECK_INTERVAL_MS) {
      log(
        `2/5 check skipped: last success ${Math.round((now - lastSuccessRef.current) / 1000)}s ago, interval is ${VERSION_CHECK_INTERVAL_MS / 1000}s`,
      );
      return;
    }
    if (now - lastAttemptRef.current < FAILED_ATTEMPT_BACKOFF_MS) {
      log("2/5 check skipped: backing off after a failed attempt");
      return;
    }
    log("2/5 checking server for latest version...");

    inFlightRef.current = true;
    lastAttemptRef.current = now;
    try {
      const result = await fetchAppVersionInfo();
      if (!result) {
        log("3/5 no usable version info (see the [appUpdate] fetch lines above)");
        return;
      }
      log("3/5 server says:", result);
      lastSuccessRef.current = Date.now();
      lastAttemptRef.current = 0;
      setInfo(result);
      AsyncStorage.setItem(
        STORAGE_KEY_SERVER_INFO,
        JSON.stringify({ info: result, fetchedAt: lastSuccessRef.current }),
      ).catch(() => {});
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const [cachedRaw, dismissedRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_SERVER_INFO),
          AsyncStorage.getItem(STORAGE_KEY_DISMISSED),
        ]);
        if (cancelled) return;

        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          const parsed = parseVersionPayload({
            android: cached?.info,
            message: cached?.info?.message,
          });
          const fetchedAt = Number(cached?.fetchedAt);
          if (parsed) {
            setInfo(parsed);
            if (Number.isFinite(fetchedAt) && fetchedAt <= Date.now()) {
              lastSuccessRef.current = fetchedAt;
            }
          }
        }
        if (dismissedRaw) setDismissed(JSON.parse(dismissedRaw));
      } catch (e) {
        console.log("[appUpdate] cache read failed:", e?.message);
      }
      if (!cancelled) checkForUpdate();
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, checkForUpdate]);

  useEffect(() => {
    if (!enabled) return undefined;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") checkForUpdate();
    });
    return () => sub.remove();
  }, [enabled, checkForUpdate]);

  // Fast-test mode only: poll on a timer so changing the server env shows up
  // without having to background/foreground the app. Never runs in release.
  useEffect(() => {
    if (!enabled || !FAST_TEST_MODE) return undefined;
    const id = setInterval(checkForUpdate, FAST_TEST_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, checkForUpdate]);

  const status = useMemo(() => {
    if (!enabled || !info) return UPDATE_STATUS.NONE;
    return getUpdateStatus({
      currentBuild,
      latestVersionCode: info.latestVersionCode,
      minimumVersionCode: info.minimumVersionCode,
    });
  }, [enabled, info, currentBuild]);

  const showBanner = useMemo(
    () =>
      status === UPDATE_STATUS.OPTIONAL &&
      !isDismissed(
        dismissed,
        info?.latestVersionCode,
        Date.now(),
        DISMISS_DURATION_MS,
      ),
    [status, dismissed, info],
  );

  // Step 4/5: the final verdict, logged whenever any input changes.
  useEffect(() => {
    if (!enabled) return;
    log("4/5 verdict:", {
      currentBuild,
      latest: info?.latestVersionCode ?? null,
      minimum: info?.minimumVersionCode ?? null,
      status,
      dismissedRecord: dismissed,
      showBanner,
    });
    if (info && status === UPDATE_STATUS.NONE) {
      log("   -> no update: currentBuild is >= latest. Lower EXPO_PUBLIC_FAKE_BUILD_NUMBER or raise LATEST_ANDROID_VERSION.");
    }
    if (status === UPDATE_STATUS.OPTIONAL && !showBanner) {
      log("   -> update available but banner hidden: you tapped 'Later' for this version within 24h. Bump LATEST_ANDROID_VERSION or clear app data.");
    }
  }, [enabled, currentBuild, info, status, dismissed, showBanner]);

  const dismiss = useCallback(() => {
    if (!info) return;
    const record = { versionCode: info.latestVersionCode, at: Date.now() };
    setDismissed(record);
    AsyncStorage.setItem(STORAGE_KEY_DISMISSED, JSON.stringify(record)).catch(
      () => {},
    );
  }, [info]);

  const body = useMemo(() => {
    const msg = (info?.message || "").trim();
    return GENERIC_SERVER_MESSAGES.includes(msg.toLowerCase())
      ? FALLBACK_BODY
      : msg;
  }, [info]);

  const value = useMemo(
    () => ({ status, showBanner, body, dismiss, openStore: openPlayStore }),
    [status, showBanner, body, dismiss],
  );

  return (
    <AppUpdateContext.Provider value={value}>
      {children}
    </AppUpdateContext.Provider>
  );
}

export function useAppUpdate() {
  return useContext(AppUpdateContext);
}
