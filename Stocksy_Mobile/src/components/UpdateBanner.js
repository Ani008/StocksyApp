import React, { useEffect, useRef, useState } from "react";
import { View, TouchableOpacity, Animated, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import AppText from "./AppText";
import { Colors, Radius, Shadows, moderateScale } from "../theme";
import { useAppUpdate } from "../context/AppUpdateProvider";
import { showToast } from "../../services/uiBridge";

export default function UpdateBanner({ style }) {
  const { showBanner, body, dismiss, openStore } = useAppUpdate();
  const [opening, setOpening] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!showBanner) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [showBanner, opacity]);

  if (!showBanner) return null;

  const handleUpdate = async () => {
    if (opening) return;
    setOpening(true);
    const opened = await openStore();
    setOpening(false);
    if (!opened) {
      showToast("Couldn't open Google Play. Please update Stocksy from the Play Store.", "error");
    }
  };

  return (
    <Animated.View style={[styles.card, { opacity }, style]}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons name="rocket-outline" size={20} color={Colors.primaryDark} />
        </View>

        <View style={styles.textWrap}>
          <AppText variant="bodyLarge" style={styles.title}>
            New version available
          </AppText>
          <AppText variant="caption" color={Colors.textSecondary} style={styles.body}>
            {body}
          </AppText>
        </View>

        <TouchableOpacity
          onPress={dismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss update notification"
        >
          <Ionicons name="close" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.laterButton}
          onPress={dismiss}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <AppText variant="caption" color={Colors.textSecondary} style={styles.laterText}>
            Later
          </AppText>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.updateButton, opening && styles.updateButtonBusy]}
          onPress={handleUpdate}
          activeOpacity={0.85}
          disabled={opening}
          accessibilityRole="button"
        >
          <AppText variant="caption" color={Colors.white} style={styles.updateText}>
            Update now
          </AppText>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 0.5,
    borderColor: Colors.border,
    padding: moderateScale(14),
    marginBottom: moderateScale(16),
    ...Shadows.card,
  },
  row: { flexDirection: "row", alignItems: "flex-start" },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginRight: moderateScale(12),
  },
  textWrap: { flex: 1, marginRight: moderateScale(8) },
  title: { fontWeight: "700" },
  body: { marginTop: 2, lineHeight: 18, fontWeight: "400" },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: moderateScale(12),
  },
  laterButton: {
    paddingVertical: moderateScale(8),
    paddingHorizontal: moderateScale(14),
    marginRight: moderateScale(6),
  },
  laterText: { fontWeight: "600" },
  updateButton: {
    backgroundColor: Colors.primaryDark,
    borderRadius: Radius.round,
    paddingVertical: moderateScale(8),
    paddingHorizontal: moderateScale(18),
  },
  updateButtonBusy: { opacity: 0.6 },
  updateText: { fontWeight: "700" },
});