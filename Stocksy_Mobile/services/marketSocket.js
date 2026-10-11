// services/marketSocket.js
//
// The app-wide market socket: marketSocketCore wired up with the real
// React Native / web implementations. Import this, not the core, in app code.
//
// On web, react-native-web's AppState maps document `visibilitychange` to
// "active" / "background", so the same code handles a backgrounded PWA tab
// and a backgrounded native app.

import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { WS_URL } from "../src/config/env";
import { showToast } from "./uiBridge";
import { createMarketSocket } from "./marketSocketCore";

// Same key api.js and authService.js use. (Read directly rather than via
// authService to avoid an import cycle: authService calls resetIdentity()).
const TOKEN_KEY = "token";

// Only an explicit "background" counts as backgrounded. On native,
// currentState can be null/"unknown" briefly at startup and "inactive" during
// transitions (app switcher, control centre, incoming call): treating those as
// "background" would skip reconnect retries at exactly the wrong moment.
const appState = {
  current: () => (AppState.currentState === "background" ? "background" : "active"),
  subscribe: (fn) => {
    const sub = AppState.addEventListener("change", (next) =>
      fn(next === "background" ? "background" : "active"),
    );
    return () => {
      if (sub && typeof sub.remove === "function") sub.remove();
    };
  },
};

// Browser online/offline events. Native has no equivalent without adding
// NetInfo, so it relies on reconnect backoff + the stale-socket watchdog.
const hasBrowserEvents =
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function";

const network = hasBrowserEvents
  ? {
      isOnline: () =>
        typeof navigator === "undefined" || navigator.onLine !== false,
      subscribe: (fn) => {
        const onOnline = () => fn(true);
        const onOffline = () => fn(false);
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
          window.removeEventListener("online", onOnline);
          window.removeEventListener("offline", onOffline);
        };
      },
    }
  : { isOnline: () => true, subscribe: () => () => {} };

const marketSocket = createMarketSocket({
  url: WS_URL,
  getToken: () => AsyncStorage.getItem(TOKEN_KEY),
  WebSocketImpl: WebSocket,
  appState,
  network,
  onToast: showToast,
  log: (...args) => {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.log("[marketSocket]", ...args);
    }
  },
});

export default marketSocket;
