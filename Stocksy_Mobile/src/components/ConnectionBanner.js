import React, { useEffect, useState, useSyncExternalStore } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import marketSocket from "../../services/marketSocket";

// A blip (the socket re-opening within a couple of seconds, a quick tab
// switch) shouldn't flash a banner, so "reconnecting" only shows after this.
const RECONNECT_BANNER_DELAY_MS = 4000;

/**
 * Thin strip at the top of the screen that tells the user live prices are NOT
 * live. Without it, a dropped connection leaves the last prices on screen
 * looking current — for a trading app, that's the worst way to fail.
 *
 *   offline (browser says so)   -> "You're offline — prices paused"
 *   online but socket is down   -> "Reconnecting to live prices…" (after a short delay)
 *
 * Only shown while a screen is actually using live data (login/signup don't).
 * Never blocks touches.
 */
export default function ConnectionBanner() {
  const { isConnected, isOnline, active } = useSyncExternalStore(
    marketSocket.subscribe,
    marketSocket.getSnapshot,
    marketSocket.getSnapshot,
  );
  const insets = useSafeAreaInsets();

  const down = active && !isConnected;
  const [delayElapsed, setDelayElapsed] = useState(false);

  useEffect(() => {
    if (!down) {
      setDelayElapsed(false);
      return undefined;
    }
    const t = setTimeout(() => setDelayElapsed(true), RECONNECT_BANNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [down]);

  if (!down) return null;

  // Offline is certain, so say so right away; "reconnecting" waits out blips.
  if (isOnline && !delayElapsed) return null;

  const offline = !isOnline;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrap,
        { paddingTop: insets.top + 6 },
        offline ? styles.offline : styles.reconnecting,
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons
        name={offline ? "cloud-offline-outline" : "sync-outline"}
        size={14}
        color="#fff"
      />
      <Text style={styles.text}>
        {offline
          ? "You're offline — prices paused"
          : "Reconnecting to live prices…"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 9999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 6,
    paddingHorizontal: 12,
    gap: 6,
  },
  offline: { backgroundColor: "#DC2626" },
  reconnecting: { backgroundColor: "#D97706" },
  text: { color: "#fff", fontSize: 12, fontWeight: "600" },
});
