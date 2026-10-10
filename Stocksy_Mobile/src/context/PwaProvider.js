import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  registerServiceWorker,
  applyUpdate as applyServiceWorkerUpdate,
} from "../pwa/serviceWorker";
import * as installPrompt from "../pwa/installPrompt";
import {
  INSTALL_MODE,
  INSTALL_SNOOZE_MS,
  UPDATE_SNOOZE_MS,
  getInstallMode,
  isIosDevice,
  isSnoozed,
  isStandaloneDisplay,
  parseDebugFlag,
} from "../utils/pwa";

const IS_WEB = Platform.OS === "web";
const STORAGE_KEY_INSTALL_DISMISSED = "pwa.installDismissedAt";

// The service worker is only registered in production builds: in dev, Metro
// serves a fresh bundle on every reload and a worker would just get in the way.
// EXPO_PUBLIC_ENABLE_SW_IN_DEV=true opts in, for testing the real update flow.
const ENABLE_SW = !__DEV__ || process.env.EXPO_PUBLIC_ENABLE_SW_IN_DEV === "true";
// ?pwa=update|install|ios in the URL forces a prompt to show (dev / opt-in only).
const DEBUG_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_PWA_DEBUG === "true";

const PwaContext = createContext({
  showUpdateBar: false,
  applyUpdate: async () => {},
  snoozeUpdate: () => {},
  installMode: INSTALL_MODE.NONE,
  showInstallCard: false,
  promptInstall: async () => "unavailable",
  dismissInstall: () => {},
});

function readIsIos() {
  if (!IS_WEB || typeof navigator === "undefined") return false;
  return isIosDevice({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

function readIsStandalone() {
  if (!IS_WEB || typeof window === "undefined") return false;
  return isStandaloneDisplay({
    displayModeStandalone:
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches,
    navigatorStandalone: typeof navigator !== "undefined" && navigator.standalone === true,
  });
}

export function PwaProvider({ children }) {
  const debugFlag = useMemo(
    () =>
      IS_WEB && typeof window !== "undefined"
        ? parseDebugFlag(window.location.search, DEBUG_ENABLED)
        : null,
    [],
  );

  // ── Update ────────────────────────────────────────────────────────────────
  const [updateReady, setUpdateReady] = useState(debugFlag === "update");
  const [updateSnoozedUntil, setUpdateSnoozedUntil] = useState(0);
  // Bumped when a snooze ends so the bar re-appears without any other trigger.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!IS_WEB || !ENABLE_SW) return undefined;
    return registerServiceWorker({ onUpdateReady: () => setUpdateReady(true) });
  }, []);

  useEffect(() => {
    if (!updateSnoozedUntil) return undefined;
    const wait = Math.max(0, updateSnoozedUntil - Date.now());
    const id = setTimeout(() => setTick((n) => n + 1), wait + 50);
    return () => clearTimeout(id);
  }, [updateSnoozedUntil]);

  const applyUpdate = useCallback(async () => {
    if (debugFlag === "update") {
      // Simulated: no real worker to swap, just close the bar.
      setUpdateReady(false);
      return;
    }
    await applyServiceWorkerUpdate();
  }, [debugFlag]);

  const snoozeUpdate = useCallback(() => {
    setUpdateSnoozedUntil(Date.now() + UPDATE_SNOOZE_MS);
  }, []);

  const showUpdateBar = IS_WEB && updateReady && Date.now() >= updateSnoozedUntil;

  // ── Install ───────────────────────────────────────────────────────────────
  const nativeState = useSyncExternalStore(
    installPrompt.subscribe,
    installPrompt.getSnapshot,
    installPrompt.getSnapshot,
  );
  const [installDismissedAt, setInstallDismissedAt] = useState(null);
  const [installStorageLoaded, setInstallStorageLoaded] = useState(false);
  const [simulatedInstalled, setSimulatedInstalled] = useState(false);

  useEffect(() => {
    if (!IS_WEB) return undefined;
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY_INSTALL_DISMISSED)
      .then((raw) => {
        if (!cancelled && raw) setInstallDismissedAt(Number(raw));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setInstallStorageLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isIos = useMemo(readIsIos, []);
  const isStandalone = useMemo(readIsStandalone, []);

  const installMode = useMemo(() => {
    if (!IS_WEB) return INSTALL_MODE.NONE;
    if (debugFlag === "install") {
      return simulatedInstalled ? INSTALL_MODE.NONE : INSTALL_MODE.NATIVE;
    }
    if (debugFlag === "ios") return INSTALL_MODE.IOS;
    return getInstallMode({
      isStandalone,
      installed: nativeState.installed,
      hasNativePrompt: nativeState.hasNativePrompt,
      isIos,
    });
  }, [debugFlag, simulatedInstalled, isStandalone, isIos, nativeState]);

  const showInstallCard =
    installMode !== INSTALL_MODE.NONE &&
    installStorageLoaded &&
    (debugFlag !== null || !isSnoozed(installDismissedAt, Date.now(), INSTALL_SNOOZE_MS));

  const dismissInstall = useCallback(() => {
    const now = Date.now();
    setInstallDismissedAt(now);
    AsyncStorage.setItem(STORAGE_KEY_INSTALL_DISMISSED, String(now)).catch(() => {});
  }, []);

  const promptInstall = useCallback(async () => {
    if (debugFlag === "install") {
      setSimulatedInstalled(true);
      return "accepted";
    }
    const outcome = await installPrompt.promptInstall();
    // Declining the browser dialog counts as "not now" for a week.
    if (outcome === "dismissed") dismissInstall();
    return outcome;
  }, [debugFlag, dismissInstall]);

  const value = useMemo(
    () => ({
      showUpdateBar,
      applyUpdate,
      snoozeUpdate,
      installMode,
      showInstallCard,
      promptInstall,
      dismissInstall,
    }),
    [
      showUpdateBar,
      applyUpdate,
      snoozeUpdate,
      installMode,
      showInstallCard,
      promptInstall,
      dismissInstall,
    ],
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa() {
  return useContext(PwaContext);
}
