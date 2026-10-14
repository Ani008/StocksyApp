import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from "react-native";
import Modal from "./AppModal";
import { Ionicons } from "@expo/vector-icons";

import watchlistService from "../../services/watchlistService";
import { showToast } from "../../services/uiBridge";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const MAX_NAME = 30;

/**
 * AddToWatchlistModal
 *
 * Opened from the stock detail screen. Shows the user's existing watchlists —
 * tap one to add / remove this stock — or lets them create a new watchlist
 * with this stock already in it.
 *
 * Props:
 * @param {boolean}  visible
 * @param {function} onClose
 * @param {string}   instrumentKey
 * @param {string}   symbol
 * @param {function} [onChanged] — called after any add / remove / create
 */
const AddToWatchlistModal = ({ visible, onClose, instrumentKey, symbol, onChanged }) => {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState(null); // list currently being toggled
  const [creating, setCreating] = useState(false); // show the name field
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setLists(await watchlistService.getWatchlists());
    } catch (err) {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fresh data every time the sheet opens, so it reflects changes made elsewhere.
  useEffect(() => {
    if (!visible) return;
    setCreating(false);
    setNewName("");
    load();
  }, [visible, load]);

  // Someone with no lists yet goes straight to naming their first one.
  const showNameField = creating || (!loading && !loadFailed && lists.length === 0);

  const contains = (list) => list.items.some((i) => i.instrument_key === instrumentKey);

  const replaceList = (updated) =>
    setLists((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));

  const toggle = async (list) => {
    if (busyId) return;
    setBusyId(list.id);
    const had = contains(list);
    try {
      const updated = had
        ? await watchlistService.removeFromWatchlist({ watchlistId: list.id, instrumentKey })
        : await watchlistService.addToWatchlist({ watchlistId: list.id, instrumentKey });
      replaceList(updated);
      showToast(
        had ? `Removed ${symbol} from ${list.name}` : `Added ${symbol} to ${list.name}`,
        "success",
      );
      onChanged?.();
    } catch (err) {
      // The api interceptor already showed the error toast.
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      showToast("Give your watchlist a name", "error");
      return;
    }
    if (submitting) return;

    setSubmitting(true);
    try {
      const created = await watchlistService.createWatchlist({ name, instrumentKey });
      setLists((prev) => [...prev, created]);
      setCreating(false);
      setNewName("");
      showToast(`Added ${symbol} to ${created.name}`, "success");
      onChanged?.();
    } catch (err) {
      // The api interceptor already showed the error toast.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Add to watchlist</Text>
              <Text style={styles.subtitle}>{symbol}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={moderateScale(18)} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading && (
            <View style={styles.center}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          )}

          {loadFailed && !loading && (
            <View style={styles.center}>
              <Text style={styles.muted}>Couldn't load your watchlists.</Text>
              <TouchableOpacity onPress={load} style={styles.retryBtn}>
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          )}

          {!loading && !loadFailed && lists.length > 0 && (
            <ScrollView
              style={styles.list}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {lists.map((list) => {
                const has = contains(list);
                const busy = busyId === list.id;
                return (
                  <TouchableOpacity
                    key={list.id}
                    style={styles.row}
                    onPress={() => toggle(list)}
                    activeOpacity={0.7}
                    disabled={!!busyId}
                  >
                    <View style={styles.rowIcon}>
                      <Ionicons name="bookmark-outline" size={moderateScale(18)} color={Colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName} numberOfLines={1}>{list.name}</Text>
                      <Text style={styles.rowMeta}>
                        {list.items.length} {list.items.length === 1 ? "stock" : "stocks"}
                      </Text>
                    </View>
                    {busy ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <Ionicons
                        name={has ? "checkmark-circle" : "add-circle-outline"}
                        size={moderateScale(24)}
                        color={has ? Colors.success : Colors.textMuted}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {!loading && !loadFailed && (
            <View style={styles.createWrap}>
              {showNameField ? (
                <>
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
                        <Text style={styles.btnPrimaryText}>Create & add {symbol}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <TouchableOpacity style={styles.newRow} onPress={() => setCreating(true)} activeOpacity={0.7}>
                  <Ionicons name="add" size={moderateScale(20)} color={Colors.primary} />
                  <Text style={styles.newRowText}>Create new watchlist</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.45)" },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: moderateScale(24),
    borderTopRightRadius: moderateScale(24),
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(10),
    paddingBottom: moderateScale(28),
    maxHeight: "80%",
  },
  handle: {
    alignSelf: "center",
    width: moderateScale(40),
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginBottom: moderateScale(14),
  },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: moderateScale(12) },
  title: { fontSize: fontScale(Typography.h4), fontWeight: "700", color: Colors.text },
  subtitle: { fontSize: fontScale(Typography.small), color: Colors.textMuted, marginTop: 2 },
  closeBtn: {
    width: moderateScale(32),
    height: moderateScale(32),
    borderRadius: moderateScale(16),
    backgroundColor: Colors.divider,
    justifyContent: "center",
    alignItems: "center",
  },
  center: { alignItems: "center", paddingVertical: moderateScale(28) },
  muted: { color: Colors.textSecondary, fontSize: fontScale(Typography.caption) },
  retryBtn: { marginTop: moderateScale(10), padding: moderateScale(8) },
  retryText: { color: Colors.primary, fontWeight: "700" },
  list: { flexGrow: 0, maxHeight: moderateScale(280) },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: moderateScale(12),
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: moderateScale(12),
  },
  rowIcon: {
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: moderateScale(12),
    backgroundColor: Colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  rowName: { fontSize: fontScale(Typography.body), fontWeight: "600", color: Colors.text },
  rowMeta: { fontSize: fontScale(Typography.small), color: Colors.textMuted, marginTop: 2 },
  createWrap: { marginTop: moderateScale(14) },
  newRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(6),
    paddingVertical: moderateScale(14),
    borderRadius: moderateScale(14),
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: "dashed",
  },
  newRowText: { color: Colors.primary, fontWeight: "700", fontSize: fontScale(Typography.body) },
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
  btnPrimary: { backgroundColor: Colors.primary, flex: 2 },
  btnPrimaryText: { color: Colors.white, fontWeight: "700", fontSize: fontScale(Typography.body) },
  btnGhost: { backgroundColor: Colors.divider },
  btnGhostText: { color: Colors.textSecondary, fontWeight: "700", fontSize: fontScale(Typography.body) },
});

export default AddToWatchlistModal;
