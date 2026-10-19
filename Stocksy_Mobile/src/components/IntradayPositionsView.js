import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Modal from "./AppModal";
import { Ionicons } from "@expo/vector-icons";
import { placeOrder, cancelOrder, fetchOrders } from "../../services/orderService";
import { createOrderAttempt, isAmbiguousFailure } from "../../services/idempotency";

// ─── Theme tokens — matches PortfolioPage.js's `C` palette so this view sits
// naturally alongside the rest of the (light) app instead of standing out as
// a separate dark screen. Kept as its own const (not imported) so this
// component stays a self-contained, drop-in-anywhere piece — if you ever
// centralise these into src/theme, swap this block for that import.
const L = {
  blue: "#1A56DB",
  blueTint: "rgba(26,86,219,0.08)",
  green: "#059669",
  greenTint: "rgba(5,150,105,0.08)",
  red: "#DC2626",
  redTint: "rgba(220,38,38,0.08)",
  bg: "#F0F4FF",
  card: "#FFFFFF",
  border: "#E2E8F0",
  textPri: "#0F172A",
  textSec: "#64748B",
  textTer: "#94A3B8",
};

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return "—";
  return (
    "₹" +
    Math.abs(n).toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

// Alert.alert is a silent no-op on react-native-web (the PWA), so every
// confirmation / error in this view must go through these helpers instead —
// otherwise taps on SL / Remove / Exit all appear to "do nothing" on the web.
function showMessage(title, message) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function confirmAction(title, message, confirmText, onConfirm) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: confirmText, style: "destructive", onPress: onConfirm },
  ]);
}

// Same identity used everywhere a position needs to be matched against its
// resting stop-loss order: wallet + instrument + product type.
function positionKey(p) {
  return `${p.wallet_id}:${p.instrument_key}:${p.product_type}`;
}

// ─── Reusable: PositionRow ────────────────────────────────────────────────────
function PositionRow({ position, onPress, onSetStopLoss, onRemoveStopLoss }) {
  const isPos = position.unrealisedPnl >= 0;
  const isShort = position.isShort ?? position.qty < 0;
  const slOrder = position.stopLossOrder; // null if none resting
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.75}
      onPress={onPress}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.tagRow}>
          <View style={styles.tag}>
            <Text style={styles.tagText}>Intraday</Text>
          </View>
          {isShort && (
            <View style={[styles.tag, styles.shortTag]}>
              <Text style={[styles.tagText, styles.shortTagText]}>Short</Text>
            </View>
          )}
          {slOrder && (
            <View style={[styles.tag, styles.slTag]}>
              <Text style={[styles.tagText, styles.slTagText]}>
                SL {fmt(parseFloat(slOrder.trigger_price), 2)}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.symbol}>{position.symbol}</Text>
        <Text style={styles.avg}>
          Avg {fmt(position.avgCost)} · Qty {Math.abs(position.qty)}
        </Text>
      </View>

      <View style={styles.rightCol}>
        <Text style={[styles.pnl, { color: isPos ? L.green : L.red }]}>
          {isPos ? "+" : "-"}
          {fmt(position.unrealisedPnl)}
        </Text>
        <Text style={styles.mkt}>
          Mkt {position.ltp != null ? fmt(position.ltp) : "—"}
        </Text>
        {slOrder ? (
          <View style={styles.slActionsRow}>
            <TouchableOpacity
              style={styles.slBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              onPress={(e) => {
                e.stopPropagation?.();
                onSetStopLoss?.(position);
              }}
            >
              <Ionicons name="create-outline" size={12} color={L.blue} />
              <Text style={styles.slBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.slBtn, styles.slRemoveBtn]}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              onPress={(e) => {
                e.stopPropagation?.();
                onRemoveStopLoss?.(position);
              }}
            >
              <Ionicons name="close-circle-outline" size={12} color={L.red} />
              <Text style={[styles.slBtnText, styles.slRemoveBtnText]}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.slBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={(e) => {
              e.stopPropagation?.();
              onSetStopLoss?.(position);
            }}
          >
            <Ionicons name="shield-half-outline" size={12} color={L.blue} />
            <Text style={styles.slBtnText}>Set SL</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Set Stop Loss modal ────────────────────────────────────────────────────
// Places a resting SL_M (stop-loss market) order on the OPPOSITE side of the
// position, for the full open quantity — same order_type/side/product_type
// contract orderService.placeOrder already validates and links to this
// position (see migration 011). SL_M rather than SL: one fewer input to get
// wrong (no limit price), and it always fills once triggered instead of
// risking a missed fill in a fast-moving/gappy print.
//
// There's no "update order" endpoint — modifying an existing SL is always a
// cancel-then-replace, same as most brokers actually implement it under the
// hood. If `existingOrder` is passed, the modal opens pre-filled with its
// trigger price, and submitting cancels that order first before placing the
// new one (so there's never a moment with two resting SL orders open).
function SetStopLossModal({ position, existingOrder, visible, onClose, onPlaced }) {
  const [trigger, setTrigger] = useState("");
  const [placing, setPlacing] = useState(false);
  // Inline error (Alert.alert is a no-op on web, so errors live in the modal).
  const [errorText, setErrorText] = useState("");
  // Duplicate-order protection (security review item 13): one idempotency key
  // for the stop-loss being set, kept across retries so a lost response or a
  // double tap can never create two resting SL orders. (Must stay above the
  // `if (!position) return null` below: hooks cannot be called conditionally.)
  const slAttempt = useRef(createOrderAttempt()).current;
  const submittingRef = useRef(false);

  // Pre-fill (or reset) the input whenever a different position/order opens
  // in the modal — a plain useState default won't pick up prop changes on
  // an already-mounted modal instance.
  useEffect(() => {
    if (visible) {
      setTrigger(existingOrder ? String(existingOrder.trigger_price) : "");
      setErrorText("");
    }
  }, [visible, existingOrder]);

  if (!position) return null;

  const isShort = position.isShort ?? position.qty < 0;
  // Closing side is always the opposite of how the position is held.
  const closingSide = isShort ? "BUY" : "SELL";
  const ltp = position.ltp;
  const isEditing = !!existingOrder;

  const handleClose = () => {
    if (placing) return;
    setTrigger("");
    onClose?.();
  };

  const handleSubmit = async () => {
    const triggerNum = parseFloat(trigger);

    if (!triggerNum || triggerNum <= 0) {
      setErrorText("Enter a trigger price. It must be a positive number.");
      return;
    }

    // Mirror the backend's own directional check (services/orderService.js
    // validateTriggerDirection) here too, so the person gets an inline
    // error instead of a round-trip rejection.
    if (ltp != null) {
      if (closingSide === "SELL" && triggerNum >= ltp) {
        setErrorText(
          `For a long position, the stop-loss trigger must be BELOW the current price (${fmt(ltp)}).`,
        );
        return;
      }
      if (closingSide === "BUY" && triggerNum <= ltp) {
        setErrorText(
          `For a short position, the stop-loss trigger must be ABOVE the current price (${fmt(ltp)}).`,
        );
        return;
      }
    }

    if (submittingRef.current) return; // synchronous double-tap guard
    submittingRef.current = true;
    setErrorText("");
    setPlacing(true);
    try {
      // Cancel-then-replace: remove the old resting SL first so there's
      // never a window with two SL orders guarding the same position.
      // (Cancelling an already-cancelled order succeeds on the server, so a
      // retry after a lost response gets past this step instead of failing.)
      if (isEditing) {
        await cancelOrder(existingOrder.id);
      }

      const payload = {
        wallet_id: position.wallet_id,
        instrument_key: position.instrument_key,
        symbol: position.symbol,
        name: position.name,
        order_type: "SL_M",
        side: closingSide,
        quantity: Math.abs(position.qty),
        trigger_price: triggerNum,
        product_type: position.product_type,
        metadata: { reason: "MANUAL_STOP_LOSS" },
      };
      await placeOrder(payload, { idempotencyKey: slAttempt.keyFor(payload) });
      slAttempt.succeeded();

      setTrigger("");
      onPlaced?.(isEditing ? "updated" : "placed");
    } catch (err) {
      slAttempt.failed(err);
      const unsure = isAmbiguousFailure(err);
      setErrorText(
        unsure
          ? "We couldn't confirm whether it went through. Tap again to retry: it won't be set twice."
          : err?.response?.data?.message || err?.message || "Something went wrong.",
      );
    } finally {
      submittingRef.current = false;
      setPlacing(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalBackdrop}
      >
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>
            {isEditing ? "Update" : "Set"} stop-loss · {position.symbol}
          </Text>
          <Text style={styles.modalSub}>
            {closingSide === "SELL"
              ? `Auto-sell ${Math.abs(position.qty)} qty if price falls to your trigger.`
              : `Auto-buy to cover ${Math.abs(position.qty)} qty if price rises to your trigger.`}
          </Text>

          <View style={styles.modalLtpRow}>
            <Text style={styles.modalLtpLabel}>Current price</Text>
            <Text style={styles.modalLtpValue}>{ltp != null ? fmt(ltp) : "—"}</Text>
          </View>

          <Text style={styles.inputLabel}>TRIGGER PRICE (₹)</Text>
          <TextInput
            style={styles.modalInput}
            value={trigger}
            onChangeText={(t) => {
              setTrigger(t);
              if (errorText) setErrorText("");
            }}
            placeholder={closingSide === "SELL" ? "e.g. below current price" : "e.g. above current price"}
            placeholderTextColor={L.textTer}
            keyboardType="decimal-pad"
            editable={!placing}
          />

          {!!errorText && <Text style={styles.modalError}>{errorText}</Text>}

          <View style={styles.modalBtnRow}>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={handleClose} disabled={placing}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalSubmitBtn, placing && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={placing}
            >
              {placing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.modalSubmitText}>
                  {isEditing ? "Update stop-loss" : "Place stop-loss"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────
/**
 * IntradayPositionsView — the "Positions" tab on the Portfolio screen.
 * Same light theme as the rest of the app (see `L` above, mirrors
 * PortfolioPage.js's `C` tokens).
 *
 * Props:
 *   positions    Array — MIS/intraday positions, already enriched with live
 *                LTP + P&L by usePortfolio() (intradayPositions).
 *   totals       Object — intradayTotals from usePortfolio() (uses
 *                totalUnrealised as "Total Returns" — the day's live P&L on
 *                open intraday positions).
 *   refreshing   boolean — pull-to-refresh spinner state
 *   onRefresh    () => Promise<void> | void
 *   onExited     () => void — called after Exit All completes, so the caller
 *                can refresh() the portfolio.
 *   onPressPosition (position) => void — row tap, e.g. navigate to StockDetail
 */
export default function IntradayPositionsView({
  positions = [],
  totals,
  refreshing = false,
  onRefresh,
  onExited,
  onPressPosition,
}) {
  const [exiting, setExiting] = useState(false);
  const [slPosition, setSlPosition] = useState(null); // position currently in the "Set SL" modal
  const [slOrdersByKey, setSlOrdersByKey] = useState({}); // positionKey -> resting SL/SL_M order
  const [removingKey, setRemovingKey] = useState(null); // positionKey currently being cancelled
  const wasRefreshingRef = useRef(false);
  const hasPositions = positions.length > 0;
  const totalReturns = totals?.totalUnrealised ?? 0;
  const isPos = totalReturns >= 0;

  // ── Load resting stop-loss orders and index them by position ───────────
  const loadStopLossOrders = useCallback(async () => {
    try {
      const orders = await fetchOrders(100, { status: "OPEN" });
      const byKey = {};
      for (const order of orders || []) {
        if (order.order_type === "SL" || order.order_type === "SL_M") {
          // Last-write-wins is fine here — cancel-then-replace means there
          // should only ever be one resting SL per position anyway.
          byKey[positionKey(order)] = order;
        }
      }
      setSlOrdersByKey(byKey);
    } catch (err) {
      // Non-critical — positions still render fine without SL badges.
    }
  }, []);

  useEffect(() => {
    loadStopLossOrders();
  }, [loadStopLossOrders]);

  // Also refresh whenever a pull-to-refresh completes (refreshing: true → false),
  // so a SL that triggered/filled elsewhere disappears from the list without
  // depending on `positions` (which changes on every live-price tick and
  // would otherwise refetch far too often).
  useEffect(() => {
    if (wasRefreshingRef.current && !refreshing) {
      loadStopLossOrders();
    }
    wasRefreshingRef.current = refreshing;
  }, [refreshing, loadStopLossOrders]);

  const enrichedPositions = positions.map((p) => ({
    ...p,
    stopLossOrder: slOrdersByKey[positionKey(p)] || null,
  }));

  const handleRemoveStopLoss = (position) => {
    const order = slOrdersByKey[positionKey(position)];
    if (!order || removingKey) return;

    confirmAction(
      "Remove stop-loss?",
      `${position.symbol} will no longer auto-close if the price hits ${fmt(parseFloat(order.trigger_price), 2)}.`,
      "Remove",
      async () => {
        const key = positionKey(position);
        setRemovingKey(key);
        try {
          await cancelOrder(order.id);
          setSlOrdersByKey((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        } catch (err) {
          showMessage(
            "Couldn't remove stop-loss",
            err?.response?.data?.message || err?.message || "Something went wrong.",
          );
        } finally {
          setRemovingKey(null);
        }
      },
    );
  };

  const handleExitAll = () => {
    if (!hasPositions || exiting) return;

    confirmAction(
      "Exit all intraday positions?",
      `This will place a MARKET order (SELL for longs, BUY for shorts) to close all ${positions.length} open intraday position${
        positions.length !== 1 ? "s" : ""
      } at the current price.`,
      "Exit all",
      runExitAll,
    );
  };

  // Duplicate-order protection (security review item 13): one idempotency key
  // per position being exited, kept if the outcome was unknown (timeout, 5xx)
  // so tapping "Exit all" again can never close a position twice.
  const exitAttempts = useRef({});
  const exitingRef = useRef(false);

  const runExitAll = async () => {
    if (exitingRef.current) return; // synchronous double-tap guard
    exitingRef.current = true;
    setExiting(true);
    const results = await Promise.allSettled(
      positions.map(async (pos) => {
        const isShort = (pos.isShort ?? pos.qty < 0);
        const slot = `${pos.wallet_id}:${pos.instrument_key}`;
        const attempt = (exitAttempts.current[slot] ??= createOrderAttempt());
        const payload = {
          wallet_id: pos.wallet_id,
          instrument_key: pos.instrument_key,
          symbol: pos.symbol,
          name: pos.name,
          order_type: "MARKET",
          // Shorts are closed by buying back, not selling again.
          side: isShort ? "BUY" : "SELL",
          quantity: Math.abs(pos.qty),
          product_type: "MIS",
          metadata: { reason: "MANUAL_EXIT_ALL" },
        };
        try {
          const res = await placeOrder(payload, { idempotencyKey: attempt.keyFor(payload) });
          attempt.succeeded();
          return res;
        } catch (err) {
          attempt.failed(err);
          throw err;
        }
      }),
    );

    const failed = results.filter((r) => r.status === "rejected");
    exitingRef.current = false;
    setExiting(false);
    onExited?.();

    if (failed.length > 0) {
      showMessage(
        "Some exits failed",
        `${results.length - failed.length} of ${results.length} positions were closed. ${
          failed.length
        } failed — check Orders for details.`,
      );
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={L.blue}
              colors={[L.blue]}
            />
          ) : undefined
        }
      >
        {/* ── Section header ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Intraday positions ({positions.length})
          </Text>
        </View>

        {/* ── Total returns card ── */}
        <View style={styles.totalsCard}>
          <View>
            <Text style={styles.totalsLabel}>TOTAL RETURNS</Text>
            <Text
              style={[
                styles.totalsValue,
                { color: hasPositions ? (isPos ? L.green : L.red) : L.textSec },
              ]}
            >
              {hasPositions ? `${isPos ? "+" : "-"}${fmt(totalReturns)}` : "₹0.00"}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.exitBtn, !hasPositions && { opacity: 0.4 }]}
            onPress={handleExitAll}
            disabled={!hasPositions || exiting}
            activeOpacity={0.8}
          >
            {exiting ? (
              <ActivityIndicator size="small" color={L.red} />
            ) : (
              <>
                <Ionicons
                  name="exit-outline"
                  size={16}
                  color={L.red}
                  style={{ marginRight: 5 }}
                />
                <Text style={styles.exitBtnText}>Exit all</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* ── List ── */}
        {hasPositions ? (
          <View style={styles.listCard}>
            <Text style={styles.openLabel}>{positions.length} OPEN</Text>
            {enrichedPositions.map((pos) => (
              <PositionRow
                key={positionKey(pos)}
                position={pos}
                onPress={() => onPressPosition?.(pos)}
                onSetStopLoss={setSlPosition}
                onRemoveStopLoss={handleRemoveStopLoss}
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyWrap}>
            <Ionicons name="flash-outline" size={36} color={L.textTer} />
            <Text style={styles.emptyTitle}>No intraday positions</Text>
            <Text style={styles.emptySub}>
              MIS orders you place today will show up here, and get
              auto-squared-off before market close.
            </Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      <SetStopLossModal
        position={slPosition}
        existingOrder={slPosition ? slOrdersByKey[positionKey(slPosition)] : null}
        visible={!!slPosition}
        onClose={() => setSlPosition(null)}
        onPlaced={(action) => {
          const symbol = slPosition?.symbol;
          setSlPosition(null);
          loadStopLossOrders(); // refresh the SL badge/actions for this position
          onExited?.(); // reuse the same "refresh portfolio" callback the parent already wires up
          showMessage(
            action === "updated" ? "Stop-loss updated" : "Stop-loss placed",
            `We'll watch ${symbol} and auto-close this position if it hits your trigger price.`,
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: L.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: L.textPri,
  },

  totalsCard: {
    backgroundColor: L.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 0.5,
    borderColor: L.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalsLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: L.textSec,
    marginBottom: 6,
  },
  totalsValue: {
    fontSize: 22,
    fontWeight: "800",
  },
  exitBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: L.redTint,
    minWidth: 84,
    justifyContent: "center",
  },
  exitBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: L.red,
  },

  listCard: {
    backgroundColor: L.card,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: L.border,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  openLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: L.textTer,
    letterSpacing: 0.5,
    marginBottom: 6,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: L.border,
  },
  tagRow: { flexDirection: "row", marginBottom: 4, gap: 6 },
  tag: {
    backgroundColor: L.blueTint,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  tagText: {
    fontSize: 10,
    fontWeight: "600",
    color: L.blue,
  },
  shortTag: {
    backgroundColor: L.redTint,
  },
  shortTagText: {
    color: L.red,
  },
  slTag: {
    backgroundColor: L.greenTint,
  },
  slTagText: {
    color: L.green,
  },
  symbol: {
    fontSize: 15,
    fontWeight: "700",
    color: L.textPri,
    marginBottom: 2,
  },
  avg: {
    fontSize: 12,
    color: L.textSec,
  },
  rightCol: {
    alignItems: "flex-end",
  },
  pnl: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  mkt: {
    fontSize: 12,
    color: L.textSec,
    marginBottom: 6,
  },
  slBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: L.blue,
  },
  slBtnText: {
    fontSize: 10,
    fontWeight: "700",
    color: L.blue,
  },
  slActionsRow: {
    flexDirection: "row",
    gap: 6,
  },
  slRemoveBtn: {
    borderColor: L.red,
  },
  slRemoveBtnText: {
    color: L.red,
  },

  emptyWrap: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 8,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: L.textPri,
  },
  emptySub: {
    fontSize: 12,
    color: L.textSec,
    textAlign: "center",
    lineHeight: 17,
  },

  // ── Set Stop Loss modal ──────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: L.card,
    borderRadius: 18,
    padding: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: L.textPri,
    marginBottom: 4,
  },
  modalSub: {
    fontSize: 12,
    color: L.textSec,
    lineHeight: 17,
    marginBottom: 14,
  },
  modalLtpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: L.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  modalLtpLabel: {
    fontSize: 12,
    color: L.textSec,
  },
  modalLtpValue: {
    fontSize: 14,
    fontWeight: "700",
    color: L.textPri,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: L.textTer,
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: L.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: L.textPri,
    marginBottom: 18,
  },
  modalError: {
    fontSize: 12,
    color: L.red,
    lineHeight: 17,
    marginTop: -8,
    marginBottom: 14,
  },
  modalBtnRow: {
    flexDirection: "row",
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: L.border,
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: "600",
    color: L.textSec,
  },
  modalSubmitBtn: {
    flex: 1.4,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: L.blue,
  },
  modalSubmitText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
});