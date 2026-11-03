import React, { useState } from "react";
import {
  FlatList,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import SegmentedToggle from "../components/SegmentedToggle";
import LeaderboardPodium from "../components/LeaderboardPodium";
import LeaderboardRow from "../components/LeaderboardRow";
import { MOCK_LEADERBOARD } from "../constants/leaderboardMock";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const TABS = [
  { key: "friends", label: "Friends" },
  { key: "global", label: "Global" },
];

// Ranks 1-3 stand on the podium; everyone after that goes in the list.
const PODIUM_SIZE = 3;

/**
 * Leaderboard page (opened from the Profile header).
 *
 * Header + Friends / Global toggle, then the top-3 podium and a scrollable list
 * for the rest. The data is MOCK_LEADERBOARD for now; once the backend is ready,
 * replace `users` with the real response (same shape, sorted by points).
 * The Friends and Global tabs show the same data until then.
 */
const LeaderboardPage = ({ navigation }) => {
  const [tab, setTab] = useState("friends");

  const users = MOCK_LEADERBOARD;
  const podium = users.slice(0, PODIUM_SIZE);
  const rest = users.slice(PODIUM_SIZE);

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

      <LeaderboardPodium entries={podium} style={styles.podium} />

      {/* Rank 4 onwards. Only this part scrolls; the podium stays put. */}
      <View style={styles.sheet}>
        <FlatList
          data={rest}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <LeaderboardRow rank={index + PODIUM_SIZE + 1} entry={item} />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      </View>
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
  podium: { marginTop: moderateScale(8) },
  // Rounded panel the list scrolls inside, sitting right under the pillars.
  sheet: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.border,
  },
  listContent: {
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(18),
    paddingBottom: moderateScale(40),
  },
});

export default LeaderboardPage;
