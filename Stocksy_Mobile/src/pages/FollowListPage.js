import React, { useState } from "react";
import {
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import AppTextInput from "../components/AppTextInput";
import SegmentedToggle from "../components/SegmentedToggle";
import { FOLLOW_TABS, EMPTY_STATE, resolveInitialTab } from "../utils/followList";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

/**
 * Followers / Following page (opened by tapping a count on the Profile header).
 *
 * Route params:
 *   initialTab  "followers" | "following"  — which tab to open on (default followers)
 *   username    optional — shown as the page title, falls back to "Connections"
 *
 * Layout: header, the Followers | Following toggle, a search bar, then the list.
 * The list is a placeholder for now (the empty message for the open tab); the
 * search bar is not connected to anything yet. When the list is wired up, the
 * backend is ready: GET /users/me/followers and /users/me/following (paged, with
 * ?q= to filter by name), and GET /users/search?q= to find people to follow.
 */
const FollowListPage = ({ navigation, route }) => {
  const [tab, setTab] = useState(() => resolveInitialTab(route?.params?.initialTab));
  const [query, setQuery] = useState("");

  const title = route?.params?.username || "Connections";
  const empty = EMPTY_STATE[tab];

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("MainTabs");
  };

  // The search box belongs to one list, so switching tab starts it fresh.
  const changeTab = (next) => {
    if (next === tab) return;
    setTab(next);
    setQuery("");
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

        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>

        <View style={styles.headerBtn} />
      </View>

      <View style={styles.toggleRow}>
        <SegmentedToggle
          theme="neutral"
          value={tab}
          onChange={changeTab}
          options={FOLLOW_TABS}
          style={styles.toggle}
        />
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={moderateScale(18)} color={Colors.textMuted} />
        <AppTextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search profiles"
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search profiles"
        />
        {query.length > 0 && (
          <TouchableOpacity
            onPress={() => setQuery("")}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={moderateScale(18)} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Placeholder for the list — replaced by the real rows once wired up. */}
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIcon}>
          <Ionicons name="people-outline" size={moderateScale(34)} color={Colors.primaryDark} />
        </View>
        <Text style={styles.emptyTitle}>{empty.title}</Text>
        <Text style={styles.emptyMessage}>{empty.message}</Text>
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
    flex: 1,
    textAlign: "center",
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
  },
  toggleRow: {
    paddingHorizontal: moderateScale(20),
    marginBottom: moderateScale(16),
  },
  toggle: { alignSelf: "center" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(10),
    marginHorizontal: moderateScale(20),
    paddingHorizontal: moderateScale(14),
    height: moderateScale(46),
    borderRadius: 14,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 0,
    fontSize: fontScale(Typography.body),
    color: Colors.text,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: moderateScale(40),
    paddingBottom: moderateScale(80),
  },
  emptyIcon: {
    width: moderateScale(72),
    height: moderateScale(72),
    borderRadius: moderateScale(36),
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: moderateScale(16),
  },
  emptyTitle: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
    textAlign: "center",
    marginBottom: moderateScale(6),
  },
  emptyMessage: {
    fontSize: fontScale(Typography.body),
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: fontScale(Typography.body) * 1.4,
  },
});

export default FollowListPage;
