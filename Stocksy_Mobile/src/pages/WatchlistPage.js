import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

import WatchlistItem from "../components/WatchlistItem";
import useMarketData from "../hooks/useMarketData";
import watchlistService from "../../services/watchlistService";
import { showToast } from "../../services/uiBridge";
import { INSTRUMENTS } from "./SearchPage";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const MAX_NAME = 30;

// Client-side metadata (logo domain) keyed by instrument_key.
const META = Object.fromEntries(INSTRUMENTS.map((i) => [i.key, i]));

const formatPrice = (ltp) =>
  ltp != null ? `₹${Number(ltp).toLocaleString("en-IN")}` : "—";

const calcChange = (ltp, cp) => {
  if (!ltp || !cp) return { label: undefined, isPositive: true };
  const pct = ((ltp - cp) / cp) * 100;
  return {
    label: `${Math.abs(pct).toFixed(2)}% ${pct >= 0 ? "▲" : "▼"}`,
    isPositive: pct >= 0,
  };
};

// Alert.alert is a no-op on web, so confirm with window.confirm there.
const confirmAction = (title, message, onConfirm) => {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: onConfirm },
  ]);
};

export default function WatchlistPage({ navigation }) {
  const { prices } = useMarketData();

  const [lists, setLists] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await watchlistService.getWatchlists();
      setLists(data);
      setLoadFailed(false);
      // Keep the current tab if it still exists, otherwise fall back to the first list.
      setSelectedId((prev) => (data.some((l) => l.id === prev) ? prev : data[0]?.id ?? null));
    } catch (err) {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch whenever the screen comes into focus — e.g. after adding a stock
  // from a stock detail page and coming back.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const selected = useMemo(
    () => lists.find((l) => l.id === selectedId) || null,
    [lists, selectedId],
  );

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      showToast("Give your watchlist a name", "error");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const created = await watchlistService.createWatchlist({ name });
      setLists((prev) => [...prev, created]);
      setSelectedId(created.id);
      setCreating(false);
      setNewName("");
    } catch (err) {
      // The api interceptor already showed the error toast.
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteList = () => {
    if (!selected) return;
    confirmAction(
      `Delete "${selected.name}"?`,
      "The watchlist and its stocks will be removed. The stocks themselves are not affected.",
      async () => {
        try {
          await watchlistService.deleteWatchlist(selected.id);
          showToast(`Deleted ${selected.name}`, "success");
          await load();
        } catch (err) {
          // Toast already shown.
        }
      },
    );
  };

  const handleRemoveStock = async (item) => {
    if (!selected) return;
    try {
      const updated = await watchlistService.removeFromWatchlist({
        watchlistId: selected.id,
        instrumentKey: item.instrument_key,
      });
      setLists((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } catch (err) {
      // Toast already shown.
    }
  };

  const openStock = (item) => {
    const meta = META[item.instrument_key];
    navigation.navigate("StockDetail", {
      instrumentKey: item.instrument_key,
      symbol: item.symbol,
      name: item.name,
      sector: item.sector,
      domain: meta?.domain,
    });
  };

  const renderNameField = () => (
    <View style={styles.createBox}>
      <Text style={styles.createLabel}>
        {lists.length === 0 ? "Create your first watchlist" : "New watchlist"}
      </Text>
      <TextInput
        style={styles.input}
        value={newName}
        onChangeText={setNewName}
        placeholder="e.g. Banking, Long term"
        placeholderTextColor={Colors.textMuted}
        maxLength={MAX_NAME}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={handleCreate}
      />
      <View style={styles.createActions}>
        {lists.length > 0 && (
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() => {
              setCreating(false);
              setNewName("");
            }}
          >
            <Text style={styles.btnGhostText}>Cancel</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, submitting && { opacity: 0.6 }]}
          onPress={handleCreate}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.btnPrimaryText}>Create</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      );
    }

    if (loadFailed && lists.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={moderateScale(40)} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>Couldn't load watchlists</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* No lists yet: straight to creating the first one */}
        {lists.length === 0 && (creating ? renderNameField() : (
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={moderateScale(48)} color={Colors.borderLight} />
            <Text style={styles.emptyTitle}>No watchlists yet</Text>
            <Text style={styles.emptySub}>
              Create a watchlist, then add stocks to it from any stock page.
            </Text>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary, styles.emptyBtn]} onPress={() => setCreating(true)}>
              <Text style={styles.btnPrimaryText}>Create watchlist</Text>
            </TouchableOpacity>
          </View>
        ))}

        {lists.length > 0 && (
          <>
            {/* Watchlist tabs */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
              keyboardShouldPersistTaps="handled"
            >
              {lists.map((l) => {
                const active = l.id === selectedId;
                return (
                  <TouchableOpacity
                    key={l.id}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setSelectedId(l.id)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                      {l.name} · {l.items.length}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity style={styles.chipAdd} onPress={() => setCreating(true)}>
                <Ionicons name="add" size={moderateScale(18)} color={Colors.primary} />
              </TouchableOpacity>
            </ScrollView>

            {creating && renderNameField()}

            {selected && (
              <>
                <View style={styles.listHeader}>
                  <Text style={styles.listTitle} numberOfLines={1}>{selected.name}</Text>
                  <TouchableOpacity onPress={handleDeleteList} hitSlop={8} style={styles.deleteListBtn}>
                    <Ionicons name="trash-outline" size={moderateScale(16)} color={Colors.danger} />
                    <Text style={styles.deleteListText}>Delete list</Text>
                  </TouchableOpacity>
                </View>

                {selected.items.length === 0 ? (
                  <View style={styles.empty}>
                    <Ionicons name="trending-up-outline" size={moderateScale(44)} color={Colors.borderLight} />
                    <Text style={styles.emptyTitle}>This watchlist is empty</Text>
                    <Text style={styles.emptySub}>
                      Open any stock and tap the bookmark icon to add it here.
                    </Text>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnPrimary, styles.emptyBtn]}
                      onPress={() => navigation.navigate("Search")}
                    >
                      <Text style={styles.btnPrimaryText}>Find stocks</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  selected.items.map((item) => {
                    const live = prices[item.instrument_key];
                    const change = calcChange(live?.ltp, live?.cp);
                    const meta = META[item.instrument_key];
                    return (
                      <View key={item.instrument_key} style={styles.itemRow}>
                        <View style={{ flex: 1 }}>
                          <WatchlistItem
                            ticker={item.symbol}
                            name={item.name}
                            price={formatPrice(live?.ltp)}
                            change={change.label}
                            isPositive={change.isPositive}
                            logoUrl={
                              meta?.domain
                                ? `https://img.logo.dev/${meta.domain}?token=pk_Bym4BAakTJudMK4MGnfpnw`
                                : undefined
                            }
                            onPress={() => openStock(item)}
                          />
                        </View>
                        <TouchableOpacity
                          style={styles.removeBtn}
                          onPress={() => handleRemoveStock(item)}
                          hitSlop={8}
                          accessibilityLabel={`Remove ${item.symbol} from ${selected.name}`}
                        >
                          <Ionicons name="close" size={moderateScale(16)} color={Colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                    );
                  })
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={moderateScale(20)} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Watchlists</Text>
        <TouchableOpacity onPress={() => navigation.navigate("Search")} style={styles.backBtn}>
          <Ionicons name="search-outline" size={moderateScale(20)} color={Colors.text} />
        </TouchableOpacity>
      </View>
      {renderBody()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(12),
    paddingBottom: moderateScale(10),
  },
  backBtn: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: moderateScale(10),
    backgroundColor: Colors.divider,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { fontSize: fontScale(Typography.h4), fontWeight: "700", color: Colors.text },
  scroll: { paddingHorizontal: moderateScale(16), paddingBottom: moderateScale(40) },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: moderateScale(24) },

  chipsRow: { gap: moderateScale(8), paddingVertical: moderateScale(8), alignItems: "center" },
  chip: {
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(8),
    borderRadius: moderateScale(20),
    backgroundColor: Colors.divider,
    maxWidth: moderateScale(200),
  },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: fontScale(Typography.small), fontWeight: "600", color: Colors.textSecondary },
  chipTextActive: { color: Colors.white },
  chipAdd: {
    width: moderateScale(34),
    height: moderateScale(34),
    borderRadius: moderateScale(17),
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
  },

  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: moderateScale(8),
    marginBottom: moderateScale(12),
  },
  listTitle: { flex: 1, fontSize: fontScale(Typography.body), fontWeight: "700", color: Colors.text },
  deleteListBtn: { flexDirection: "row", alignItems: "center", gap: moderateScale(4) },
  deleteListText: { color: Colors.danger, fontSize: fontScale(Typography.small), fontWeight: "600" },

  itemRow: { flexDirection: "row", alignItems: "center", gap: moderateScale(8) },
  removeBtn: {
    width: moderateScale(28),
    height: moderateScale(28),
    borderRadius: moderateScale(14),
    backgroundColor: Colors.divider,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: moderateScale(12), // matches WatchlistItem's bottom margin so it stays centred on the card
  },

  empty: { alignItems: "center", paddingVertical: moderateScale(48), paddingHorizontal: moderateScale(24) },
  emptyTitle: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
    marginTop: moderateScale(12),
  },
  emptySub: {
    fontSize: fontScale(Typography.caption),
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: moderateScale(6),
    lineHeight: moderateScale(20),
  },
  emptyBtn: { marginTop: moderateScale(18), flex: 0, paddingHorizontal: moderateScale(28) },
  retryBtn: { marginTop: moderateScale(10), padding: moderateScale(8) },
  retryText: { color: Colors.primary, fontWeight: "700" },

  createBox: {
    backgroundColor: Colors.white,
    borderRadius: moderateScale(16),
    padding: moderateScale(16),
    marginVertical: moderateScale(8),
  },
  createLabel: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: moderateScale(8),
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: moderateScale(12),
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(12),
    fontSize: fontScale(Typography.body),
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  createActions: { flexDirection: "row", gap: moderateScale(10), marginTop: moderateScale(12) },
  btn: {
    flex: 1,
    paddingVertical: moderateScale(14),
    borderRadius: moderateScale(14),
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: { backgroundColor: Colors.primary },
  btnPrimaryText: { color: Colors.white, fontWeight: "700", fontSize: fontScale(Typography.body) },
  btnGhost: { backgroundColor: Colors.divider },
  btnGhostText: { color: Colors.textSecondary, fontWeight: "700", fontSize: fontScale(Typography.body) },
});
