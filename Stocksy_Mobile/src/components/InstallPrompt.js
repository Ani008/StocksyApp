import React, { useState } from "react";
import { View, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import AppText from "./AppText";
import { Colors, Radius, Shadows, moderateScale } from "../theme";
import { usePwa } from "../context/PwaProvider";
import { INSTALL_MODE } from "../utils/pwa";

const IOS_STEPS = [
  { icon: "share-outline", text: "Tap the Share button in Safari's toolbar" },
  { icon: "add-circle-outline", text: "Scroll down and tap “Add to Home Screen”" },
  { icon: "checkmark-circle-outline", text: "Tap “Add”, then open Stocksy from your home screen" },
];

// "Install Stocksy" card (web only). On Android / desktop Chrome the button
// opens the browser's install dialog; iOS has no such API, so the button
// reveals Add-to-Home-Screen instructions instead.
export default function InstallPrompt({ style }) {
  const { installMode, showInstallCard, promptInstall, dismissInstall } = usePwa();
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  if (Platform.OS !== "web" || !showInstallCard) return null;

  const isIos = installMode === INSTALL_MODE.IOS;

  const handlePrimary = async () => {
    if (isIos) {
      setShowSteps((v) => !v);
      return;
    }
    if (busy) return;
    setBusy(true);
    await promptInstall();
    setBusy(false);
  };

  return (
    <View style={[styles.card, style]} accessibilityRole="summary">
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons name="phone-portrait-outline" size={20} color={Colors.primaryDark} />
        </View>

        <View style={styles.textWrap}>
          <AppText variant="bodyLarge" style={styles.title}>
            Install Stocksy
          </AppText>
          <AppText variant="caption" color={Colors.textSecondary} style={styles.body}>
            Add it to your home screen for one-tap access and a full-screen, app-like experience.
          </AppText>
        </View>

        <TouchableOpacity
          onPress={dismissInstall}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss install suggestion"
        >
          <Ionicons name="close" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {isIos && showSteps && (
        <View style={styles.steps}>
          {IOS_STEPS.map((step, i) => (
            <View key={step.icon} style={styles.stepRow}>
              <View style={styles.stepNumber}>
                <AppText variant="caption" color={Colors.primaryDark} style={styles.stepNumberText}>
                  {i + 1}
                </AppText>
              </View>
              <Ionicons name={step.icon} size={20} color={Colors.primaryDark} />
              <AppText variant="caption" color={Colors.text} style={styles.stepText}>
                {step.text}
              </AppText>
            </View>
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.laterButton}
          onPress={dismissInstall}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <AppText variant="caption" color={Colors.textSecondary} style={styles.laterText}>
            Not now
          </AppText>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryButton, busy && styles.busy]}
          onPress={handlePrimary}
          activeOpacity={0.85}
          disabled={busy}
          accessibilityRole="button"
        >
          <AppText variant="caption" color={Colors.white} style={styles.primaryText}>
            {isIos ? (showSteps ? "Hide steps" : "Show me how") : "Install"}
          </AppText>
        </TouchableOpacity>
      </View>
    </View>
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
  steps: {
    marginTop: moderateScale(12),
    paddingTop: moderateScale(12),
    borderTopWidth: 0.5,
    borderTopColor: Colors.divider,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: moderateScale(10),
  },
  stepNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginRight: moderateScale(8),
  },
  stepNumberText: { fontWeight: "700", fontSize: 11 },
  stepText: { flex: 1, marginLeft: moderateScale(10), lineHeight: 18, fontWeight: "500" },
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
  primaryButton: {
    backgroundColor: Colors.primaryDark,
    borderRadius: Radius.round,
    paddingVertical: moderateScale(8),
    paddingHorizontal: moderateScale(18),
  },
  busy: { opacity: 0.6 },
  primaryText: { fontWeight: "700" },
});




//IOS GOOGLE LOGIN NOT WORKING ACCOUNT SELECTION TAB NOT OPENS ON ANDROID & COMPUTER NO PROBLEM GOOGLE LOGIN WORKS
//LOGOS ARE NOT VISIBLE ON WEB PWA
//ON ANDROID PWA GOOGLE LOGIN WORKS AND THE BANNER INSTALL STOCKSY VISIBLE BUT WHEN CLIKED ON INSTALL PLAY STORE SHOULD OPEN INSTEAD ITS DOWNLAODING WEB PWA VERSION.
//on android PWA PORTFOLIO SCREEN LAYOUT HAS BEEN MESSEDUP
//TCS AND TATA STEEL LOGO ARE CORRECT STILL NOT RENDERING.
// when iam in page instead of coming back to previous screen iam going outside of the pwa on chrome page directly