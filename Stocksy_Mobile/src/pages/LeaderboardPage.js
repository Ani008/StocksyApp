import React, { useState } from "react";
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import SegmentedToggle from "../components/SegmentedToggle";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const TABS = [
  { key: "friends", label: "Friends" },
  { key: "global", label: "Global" },
];

/**
 * Leaderboard page (opened from the Profile header).
 *
 * Step 1 is just the shell: header + the Friends / Global toggle, with an empty
 * body. The rankings, animation and backend data come in the next steps.
 */
const LeaderboardPage = ({ navigation }) => {
  const [tab, setTab] = useState("friends");

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("MainTabs");
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.headerBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={moderateScale(20)} color={Colors.text} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Leaderboard</Text>

        <View style={styles.headerBtn} />
      </View>

      <View style={styles.toggleRow}>
        <SegmentedToggle
          theme="neutral"
          value={tab}
          onChange={setTab}
          options={TABS}
          style={styles.toggle}
        />
      </View>

      {/* Body intentionally blank for now: Friends / Global lists come next. */}
      <View style={styles.body} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: moderateScale(20),
    paddingVertical: moderateScale(14),
  },
  headerBtn: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: moderateScale(18),
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
  },
  toggleRow: {
    paddingHorizontal: moderateScale(20),
    marginBottom: moderateScale(16),
  },
  toggle: { alignSelf: "center" },
  body: { flex: 1 },
});

export default LeaderboardPage;
