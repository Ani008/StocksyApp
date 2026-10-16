import React, { useState } from "react";
import { View, TouchableOpacity, StyleSheet, Platform, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import AppText from "./AppText";
import { Colors, Radius, moderateScale } from "../theme";
import { isIosDevice, isStandaloneDisplay } from "../utils/pwa";

// Android package id comes from app.json (expo.android.package).
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.stocksy.app";

function detect() {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return "none";

  const standalone = isStandaloneDisplay({
    displayModeStandalone:
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches,
    navigatorStandalone: navigator.standalone === true,
  });
  // Already running as an installed home-screen app: nothing to suggest.
  if (standalone) return "none";

  if (
    isIosDevice({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    })
  ) {
    return "ios";
  }
  if (/Android/i.test(navigator.userAgent || "")) return "android";
  return "none";
}

// Web only. Shown on the login screen to visitors using Stocksy in a browser:
//  - iPhone / iPad: there is no App Store app, so say so and point to Add to
//    Home Screen.
//  - Android: the real app is on Google Play, so link to it.
// Nothing renders inside the native apps, the installed home-screen app, or
// on desktop browsers.
export default function StoreNotice({ style }) {
  const [kind] = useState(detect);
  const [dismissed, setDismissed] = useState(false);

  if (kind === "none" || dismissed) return null;

  const isIos = kind === "ios";

  return (
    <View style={[styles.card, style]} accessibilityRole="summary">
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons
            name={isIos ? "information-circle-outline" : "logo-google-playstore"}
            size={20}
            color={Colors.primaryDark}
          />
        </View>

        <View style={styles.textWrap}>
          <AppText variant="bodyLarge" style={styles.title}>
            {isIos ? "Stocksy isn't on the App Store" : "Get the Stocksy Android app"}
          </AppText>
          <AppText variant="caption" color={Colors.textSecondary} style={styles.body}>
            {isIos
              ? "You can use Stocksy right here in Safari. To keep it on your Home Screen like an app, tap Share, then Add to Home Screen."
              : "Stocksy is available on Google Play for a faster, full-screen experience."}
          </AppText>

          {!isIos && (
            <TouchableOpacity
              style={styles.button}
              onPress={() => Linking.openURL(PLAY_STORE_URL)}
              activeOpacity={0.85}
              accessibilityRole="link"
            >
              <AppText variant="caption" color={Colors.white} style={styles.buttonText}>
                Open Google Play
              </AppText>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          onPress={() => setDismissed(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss this notice"
        >
          <Ionicons name="close" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.lg,
    padding: moderateScale(14),
    marginBottom: moderateScale(20),
  },
  row: { flexDirection: "row", alignItems: "flex-start" },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
    marginRight: moderateScale(12),
  },
  textWrap: { flex: 1, marginRight: moderateScale(8) },
  title: { fontWeight: "700" },
  body: { marginTop: 2, lineHeight: 18, fontWeight: "400" },
  button: {
    alignSelf: "flex-start",
    backgroundColor: Colors.primaryDark,
    borderRadius: Radius.round,
    paddingVertical: moderateScale(8),
    paddingHorizontal: moderateScale(18),
    marginTop: moderateScale(10),
  },
  buttonText: { fontWeight: "700" },
});
