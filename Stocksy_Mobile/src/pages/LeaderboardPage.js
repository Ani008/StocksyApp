import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
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
import { getLeaderboard } from "../../services/leaderboardService";
import {
  DEFAULT_TAB,
  FRIENDS_ALONE,
  LEADERBOARD_TABS,
  LOAD_ERROR,
  NOBODY,
  NOT_RANKED,
  isFriendsAlone,
  isUnranked,
  normalizeBoard,
  pinnedMe,
  rankSummary,
  splitBoard,
} from "../utils/leaderboard";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

/**
 * Leaderboard page (opened from the Profile header).
 *
 * Header + Friends / Global toggle, then the top-3 podium and a scrollable list
 * for the rest. The ranking comes from the server (GET /api/leaderboard):
 *
 *   Friends  you and the people you follow, ranked against each other
 *   Global   everyone on Stocksy
 *
 * Every row carries its real rank. Your own row is outlined and tagged "You";
 * if you rank below the rows loaded, it is pinned under the list so you always
 * see where you stand. Pull down to refresh; the board also refreshes whenever
 * you come back to this screen.
 */
const LeaderboardPage = ({ navigation }) => {
  const [tab, setTab] = useState(DEFAULT_TAB);

  const [board, setBoard] = useState(null); // { entries, me, total } for the open tab
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0); // bump to load again

  const requestRef = useRef(0); // only the newest request may write to the page
  const quietRef = useRef(false); // refresh keeps the rows on screen instead of a spinner
  const replayRef = useRef(false); // play the podium animation once the new data lands

  // The podium animations (rise, count-up, glow) play every time this screen is
  // opened or its board changes. Changing the podium's `key` rebuilds it, which
  // restarts them. The first open already plays them on first render; after
  // that, coming back into focus (e.g. returning from another screen while this
  // one stayed mounted) reloads the board quietly and replays them with the
  // fresh numbers.
  const [playKey, setPlayKey] = useState(0);
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      quietRef.current = true;
      replayRef.current = true;
      setReloadKey((k) => k + 1);
    }, []),
  );

  // (Re)load the board whenever the tab changes or a reload is asked for.
  useEffect(() => {
    const requestId = ++requestRef.current;
    const quiet = quietRef.current;
    quietRef.current = false;
    const replay = replayRef.current;
    replayRef.current = false;

    // Another tab's rows must not show while this one loads.
    if (!quiet) {
      setBoard(null);
      setStatus("loading");
    }

    (async () => {
      try {
        const data = await getLeaderboard(tab);
        if (requestId !== requestRef.current) return;
        setBoard(normalizeBoard(data));
        setStatus("ready");
        if (replay) setPlayKey((k) => k + 1);
      } catch {
        if (requestId !== requestRef.current) return;
        // A quiet refresh that fails keeps what is on screen; only a fresh load
        // shows the error.
        if (!quiet) {
          setBoard(null);
          setStatus("error");
        }
      } finally {
        if (requestId === requestRef.current) setRefreshing(false);
      }
    })();

    // Leaving (or reloading) makes this request out of date.
    return () => {
      requestRef.current += 1;
    };
  }, [tab, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const onRefresh = () => {
    quietRef.current = true;
    setRefreshing(true);
    reload();
  };

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("MainTabs");
  };

  const findPeople = () => navigation.navigate("FollowList", { initialTab: "following" });

  const { podium, rest } = splitBoard(board?.entries ?? []);
  const pinned = pinnedMe(board);
  const alone = status === "ready" && isFriendsAlone(tab, board);
  const unranked = status === "ready" && isUnranked(board);

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={Colors.primaryDark}
      colors={[Colors.primaryDark]}
    />
  );

  // Shown under the podium when the list part has nothing to list.
  const renderEmpty = () => {
    if (alone) {
      return (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons name="people-outline" size={moderateScale(30)} color={Colors.primaryDark} />
          </View>
          <Text style={styles.emptyTitle}>{FRIENDS_ALONE.title}</Text>
          <Text style={styles.emptyMessage}>{FRIENDS_ALONE.message}</Text>
          <TouchableOpacity
            style={styles.actionBtn}
            activeOpacity={0.8}
            onPress={findPeople}
            accessibilityRole="button"
            accessibilityLabel={FRIENDS_ALONE.action}
          >
            <Text style={styles.actionText}>{FRIENDS_ALONE.action}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    // Fewer than 4 people on the board: the podium already shows everyone.
    return null;
  };

  const renderBody = () => {
    if (status === "loading") {
      return (
        <View style={styles.centerWrap}>
          <ActivityIndicator size="large" color={Colors.primaryDark} />
        </View>
      );
    }

    if (status === "error") {
      return (
        <View style={styles.centerWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons name="cloud-offline-outline" size={moderateScale(34)} color={Colors.primaryDark} />
          </View>
          <Text style={styles.emptyTitle}>{LOAD_ERROR.title}</Text>
          <Text style={styles.emptyMessage}>{LOAD_ERROR.message}</Text>
          <TouchableOpacity
            style={styles.actionBtn}
            activeOpacity={0.8}
            onPress={reload}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={styles.actionText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!board || board.entries.length === 0) {
      return (
        <View style={styles.centerWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons name="trophy-outline" size={moderateScale(34)} color={Colors.primaryDark} />
          </View>
          <Text style={styles.emptyTitle}>{NOBODY.title}</Text>
          <Text style={styles.emptyMessage}>{NOBODY.message}</Text>
        </View>
      );
    }

    return (
      <>
        <LeaderboardPodium key={`${tab}-${playKey}`} entries={podium} style={styles.podium} />

        {/* Rank 4 onwards. Only this part scrolls; the podium stays put. */}
        <View style={styles.sheet}>
          <FlatList
            data={rest}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <LeaderboardRow rank={item.rank} entry={item} />}
            ListEmptyComponent={renderEmpty}
            refreshControl={refreshControl}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />

          {/* Others are ranked but you have no points yet. */}
          {unranked && (
            <View style={styles.pinned}>
              <Text style={styles.unrankedText}>{NOT_RANKED}</Text>
            </View>
          )}

          {/* Your own row when you rank below the rows loaded. */}
          {pinned && (
            <View style={styles.pinned}>
              <Text style={styles.pinnedLabel}>
                Your rank · {rankSummary(pinned, board.total)}
              </Text>
              <LeaderboardRow rank={pinned.rank} entry={pinned} style={styles.pinnedRow} />
            </View>
          )}
        </View>
      </>
    );
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
          options={LEADERBOARD_TABS}
          style={styles.toggle}
        />
      </View>

      {renderBody()}
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
  // "Your rank" strip stuck to the bottom of the panel.
  pinned: {
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(10),
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  pinnedLabel: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "700",
    color: Colors.textSecondary,
    marginBottom: moderateScale(8),
  },
  pinnedRow: { marginBottom: moderateScale(12) },
  unrankedText: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "600",
    color: Colors.textSecondary,
    textAlign: "center",
    paddingBottom: moderateScale(14),
  },
  // Loading / error / nobody-yet: fills the space under the toggle.
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: moderateScale(32),
    paddingBottom: moderateScale(60),
  },
  // Inside the list panel (friends board with nobody followed).
  emptyWrap: {
    alignItems: "center",
    paddingHorizontal: moderateScale(12),
    paddingTop: moderateScale(24),
  },
  emptyIcon: {
    width: moderateScale(64),
    height: moderateScale(64),
    borderRadius: moderateScale(32),
    backgroundColor: Colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: moderateScale(14),
  },
  emptyTitle: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "800",
    color: Colors.text,
    textAlign: "center",
  },
  emptyMessage: {
    marginTop: moderateScale(6),
    fontSize: fontScale(Typography.body),
    color: Colors.textSecondary,
    textAlign: "center",
  },
  actionBtn: {
    marginTop: moderateScale(18),
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingHorizontal: moderateScale(22),
    paddingVertical: moderateScale(11),
  },
  actionText: {
    fontSize: fontScale(Typography.body),
    fontWeight: "700",
    color: Colors.white,
  },
});

export default LeaderboardPage;
