import React, { useState } from "react";
import { View, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import AppText from "./AppText";
import { Colors, Radius, moderateScale } from "../theme";
import { usePwa } from "../context/PwaProvider";

// Full-width bar pinned above the whole app (web only) telling the user a new
// version has been downloaded. It sits in normal layout flow — pushing the app
// down — rather than floating over it, so it never hides headers or buttons.
export default function PwaUpdateBar() {
  const { showUpdateBar, applyUpdate, snoozeUpdate } = usePwa();
  const [refreshing, setRefreshing] = useState(false);

  if (Platform.OS !== "web" || !showUpdateBar) return null;

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await applyUpdate();
    // On the real path the page reloads, so this only matters if it didn't.
    setRefreshing(false);
  };

  return (
    <View
      style={styles.bar}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="rocket-outline" size={18} color={Colors.white} />

      <View style={styles.textWrap}>
        <AppText variant="caption" color={Colors.white} style={styles.title}>
          New version available
        </AppText>
        <AppText variant="caption" color={Colors.primaryLight} style={styles.sub}>
          Refresh to get the latest prices, fixes and features.
        </AppText>
      </View>

      <TouchableOpacity
        style={[styles.refreshButton, refreshing && styles.busy]}
        onPress={handleRefresh}
        disabled={refreshing}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Refresh to update Stocksy"
      >
        <AppText variant="caption" color={Colors.primaryDark} style={styles.refreshText}>
          {refreshing ? "Updating…" : "Refresh"}
        </AppText>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={snoozeUpdate}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Remind me later"
      >
        <AppText variant="caption" color={Colors.primaryLight} style={styles.later}>
          Later
        </AppText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: moderateScale(14),
    paddingBottom: moderateScale(10),
    // Keeps the bar clear of the notch / status bar when the installed PWA
    // draws edge to edge (needs viewport-fit=cover, which resolves to 0 until then).
    paddingTop: "calc(10px + env(safe-area-inset-top))",
    zIndex: 1000,
  },
  textWrap: { flex: 1, marginHorizontal: moderateScale(10) },
  title: { fontWeight: "700" },
  sub: { marginTop: 1, fontWeight: "400" },
  refreshButton: {
    backgroundColor: Colors.white,
    borderRadius: Radius.round,
    paddingVertical: moderateScale(6),
    paddingHorizontal: moderateScale(14),
    marginRight: moderateScale(12),
  },
  busy: { opacity: 0.6 },
  refreshText: { fontWeight: "700" },
  later: { fontWeight: "600" },
});
