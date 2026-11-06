import React, { useCallback, useEffect, useRef, useState } from "react";
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

import AppTextInput from "../components/AppTextInput";
import SegmentedToggle from "../components/SegmentedToggle";
import UserCard from "../components/UserCard";
import {
  bumpStoredFollowingCount,
  followUser,
  getConnections,
  searchUsers,
  unfollowUser,
} from "../../services/followService";
import { FOLLOW_TABS, EMPTY_STATE, resolveInitialTab } from "../utils/followList";
import {
  LOAD_ERROR,
  NO_RESULTS,
  cleanQuery,
  followButtonState,
  isSearchable,
  mergeUsers,
  normalizeUsers,
  withFollowState,
} from "../utils/followUsers";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

// How long to wait after the last keystroke before asking the server.
const SEARCH_DELAY_MS = 350;

/**
 * Followers / Following page (opened by tapping a count on the Profile header).
 *
 * Route params:
 *   initialTab  "followers" | "following"  — which tab to open on (default followers)
 *   username    optional — shown as the page title, falls back to "Connections"
 *
 * Layout: header, the Followers | Following toggle, a search bar, then a list of
 * people cards (avatar, username, full name, Follow button).
 *
 *   - Search box empty (or 1 character): your followers / following for the open tab.
 *   - 2+ characters: everyone on Stocksy whose username or name matches, so you
 *     can find people to follow. Tapping a tab clears the search.
 *
 * Following someone moves their followers count and your following count on the
 * server; the Profile re-reads both when you go back to it.
 */
const FollowListPage = ({ navigation, route }) => {
  const [tab, setTab] = useState(() => resolveInitialTab(route?.params?.initialTab));
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState(""); // `query` after the typing pause

  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0); // bump to load again
  const [pending, setPending] = useState({}); // user id → true while following / unfollowing

  const requestRef = useRef(0); // only the newest request may write to the page
  const scopeRef = useRef(null); // which list is on screen: "followers" | "following" | "search"
  const quietReloadRef = useRef(false); // pull-to-refresh keeps the rows on screen

  const title = route?.params?.username || "Connections";
  // Based on `term` (the text after the typing pause), so the list switches to
  // search results once, when they are asked for — not on the first keystroke.
  const searching = isSearchable(term);
  const scope = searching ? "search" : tab;

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

  // Wait for a pause in typing before searching. Dropping below the minimum
  // length (or clearing the box) goes straight back to the tab list, no delay.
  useEffect(() => {
    if (!isSearchable(query)) {
      setTerm("");
      return undefined;
    }
    const timer = setTimeout(() => setTerm(cleanQuery(query)), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // (Re)load the list whenever what should be on screen changes.
  useEffect(() => {
    // Anything still in flight is now out of date and must not write to the page.
    const requestId = ++requestRef.current;
    const quiet = quietReloadRef.current;
    quietReloadRef.current = false;

    // A different list (another tab, or search ↔ tab) must not show the old
    // one's rows while it loads. A new search term on the same search keeps
    // the previous results until the new ones arrive.
    if (scopeRef.current !== scope && !quiet) {
      setItems([]);
      setNextCursor(null);
    }
    scopeRef.current = scope;
    setLoadingMore(false);
    if (!quiet) setStatus("loading");

    (async () => {
      try {
        const page = searching
          ? { users: await searchUsers(term), nextCursor: null }
          : await getConnections(tab);
        if (requestId !== requestRef.current) return;
        setItems(normalizeUsers(page.users));
        setNextCursor(page.nextCursor);
        setStatus("ready");
      } catch {
        if (requestId !== requestRef.current) return;
        setItems([]);
        setNextCursor(null);
        setStatus("error");
      } finally {
        if (requestId === requestRef.current) setRefreshing(false);
      }
    })();

    return undefined;
  }, [scope, searching, term, tab, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const onRefresh = () => {
    quietReloadRef.current = true;
    setRefreshing(true);
    reload();
  };

  // Next page of followers / following. (Search results are one page.)
  const loadMore = useCallback(async () => {
    if (searching || !nextCursor || loadingMore || status !== "ready") return;
    const requestId = requestRef.current;
    setLoadingMore(true);
    try {
      const page = await getConnections(tab, { cursor: nextCursor });
      if (requestId !== requestRef.current) return;
      setItems((prev) => mergeUsers(prev, page.users));
      setNextCursor(page.nextCursor);
    } catch {
      /* keep what is shown; scrolling to the end again retries */
    } finally {
      if (requestId === requestRef.current) setLoadingMore(false);
    }
  }, [searching, nextCursor, loadingMore, status, tab]);

  // Follow / unfollow. The button shows a spinner while the request runs and
  // flips only once the server has said yes; on failure api.js shows the toast
  // and the card stays as it was.
  const toggleFollow = async (user) => {
    const button = followButtonState(user);
    if (!button || pending[user.id]) return;
    const follow = button.action === "follow";

    setPending((p) => ({ ...p, [user.id]: true }));
    try {
      const result = follow ? await followUser(user.id) : await unfollowUser(user.id);
      setItems((prev) => withFollowState(prev, user.id, result?.isFollowing ?? follow));
      bumpStoredFollowingCount(follow ? 1 : -1);
    } catch {
      /* toast already shown */
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[user.id];
        return next;
      });
    }
  };

  const renderItem = ({ item }) => (
    <UserCard user={item} busy={Boolean(pending[item.id])} onToggle={toggleFollow} />
  );

  const renderEmpty = () => {
    if (status === "loading") {
      return (
        <View style={styles.emptyWrap}>
          <ActivityIndicator size="large" color={Colors.primaryDark} />
        </View>
      );
    }

    const copy = status === "error" ? LOAD_ERROR : searching ? NO_RESULTS : EMPTY_STATE[tab];
    return (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIcon}>
          <Ionicons
            name={status === "error" ? "cloud-offline-outline" : "people-outline"}
            size={moderateScale(34)}
            color={Colors.primaryDark}
          />
        </View>
        <Text style={styles.emptyTitle}>{copy.title}</Text>
        <Text style={styles.emptyMessage}>{copy.message}</Text>
        {status === "error" && (
          <TouchableOpacity
            style={styles.retryBtn}
            activeOpacity={0.8}
            onPress={reload}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        )}
      </View>
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
          placeholder="Search by username or name"
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

      <FlatList
        data={items}
        keyExtractor={(user) => user.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={styles.footer} color={Colors.primaryDark} />
          ) : null
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primaryDark}
            colors={[Colors.primaryDark]}
          />
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.listContent, items.length === 0 && styles.listContentEmpty]}
      />
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
  listContent: {
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(16),
    paddingBottom: moderateScale(32),
  },
  // Lets the empty / loading message centre in the space under the search box.
  listContentEmpty: { flexGrow: 1 },
  footer: { paddingVertical: moderateScale(16) },
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
  retryBtn: {
    marginTop: moderateScale(18),
    paddingHorizontal: moderateScale(22),
    paddingVertical: moderateScale(10),
    borderRadius: 999,
    backgroundColor: Colors.primaryDark,
  },
  retryText: {
    color: Colors.white,
    fontWeight: "700",
    fontSize: fontScale(Typography.caption),
  },
});

export default FollowListPage;
