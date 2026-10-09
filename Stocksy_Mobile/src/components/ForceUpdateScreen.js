import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Colors, Radius, moderateScale } from "../theme";
import { useAppUpdate } from "../context/AppUpdateProvider";

export default function ForceUpdateScreen() {
  const { openStore } = useAppUpdate();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleUpdate = async () => {
    if (opening) return;
    setOpening(true);
    setFailed(false);
    const opened = await openStore();
    setOpening(false);
    if (!opened) setFailed(true);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Ionicons name="cloud-download-outline" size={34} color={Colors.primaryDark} />
        </View>

        <Text style={styles.title}>Stocksy needs an update</Text>
        <Text style={styles.subtitle}>
          Please update to the latest version to continue using Stocksy.
        </Text>

        <TouchableOpacity
          style={[styles.button, opening && styles.buttonBusy]}
          onPress={handleUpdate}
          activeOpacity={0.85}
          disabled={opening}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Update Stocksy</Text>
        </TouchableOpacity>

        {failed && (
          <Text style={styles.error}>
            Couldn't open Google Play. Please open the Play Store and update Stocksy.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: moderateScale(32),
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  title: { fontSize: 18, fontWeight: "600", color: Colors.text, marginBottom: 8 },
  subtitle: {
    fontSize: 13.5,
    color: Colors.textSecondary,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 280,
    marginBottom: 32,
  },
  button: {
    width: "100%",
    backgroundColor: Colors.primaryDark,
    borderRadius: Radius.lg,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: Colors.white, fontSize: 15, fontWeight: "600" },
  error: {
    marginTop: 16,
    fontSize: 12.5,
    color: Colors.dangerDark,
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 280,
  },
});