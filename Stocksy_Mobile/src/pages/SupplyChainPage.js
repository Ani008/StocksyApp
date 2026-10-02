// src/pages/SupplyChainPage.js
// ─────────────────────────────────────────────────────────────────────────────
// Supply chain graph for one stock.
//
//     suppliers (left)  →  [ this stock ]  →  customers (right)
//
// Reached from the graph icon next to the bell on the Stock Detail screen.
// Data: GET /api/supply-chain/:symbol (see services/supplyChainService.js).
// Tapping a highlighted company opens that stock's Stock Detail page.
// A company is highlighted only if it exists in the app's own stock list
// (INSTRUMENTS in SearchPage.js) — unlisted/government/foreign companies and
// stocks the app doesn't carry stay as plain boxes.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import { fetchSupplyChain } from "../../services/supplyChainService";
import { INSTRUMENTS } from "./SearchPage";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const SCREEN_PAD = 16;
const ARROW_GAP = 22;
const CENTER_W = 92;

// symbol -> { key, symbol, name, sector, domain } for stocks in this app
const INSTRUMENT_BY_SYMBOL = INSTRUMENTS.reduce((acc, i) => {
  acc[i.symbol] = i;
  return acc;
}, {});

const CONFIDENCE_COLOR = {
  HIGH: Colors.success,
  MEDIUM: Colors.warning,
  LOW: Colors.danger,
};

// ─── One company box in a side column ───────────────────────────────────────
function Node({ node, width, onPress }) {
  const inApp = !!(node.symbol && INSTRUMENT_BY_SYMBOL[node.symbol]);
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      disabled={!inApp}
      onPress={() => onPress(node)}
      style={[styles.node, { width }, inApp && styles.nodeTappable]}
    >
      <Text style={styles.nodeName} numberOfLines={2}>
        {node.name}
      </Text>
      <Text style={styles.nodeItem} numberOfLines={2}>
        {node.item}
      </Text>
      <View style={styles.nodeFooter}>
        <View
          style={[
            styles.confDot,
            { backgroundColor: CONFIDENCE_COLOR[node.confidence] || Colors.textMuted },
          ]}
        />
        {inApp ? (
          <Ionicons
            name="chevron-forward"
            size={moderateScale(13)}
            color={Colors.primary}
          />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Placeholder when one side has no rows ──────────────────────────────────
function EmptySide({ width, label }) {
  return (
    <View style={[styles.node, styles.nodeEmpty, { width }]}>
      <Text style={styles.nodeEmptyText}>{label}</Text>
    </View>
  );
}

const SupplyChainPage = ({ navigation, route }) => {
  const { symbol, name } = route.params;
  const { width: screenW } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [graph, setGraph] = useState(null); // null = no data in DB

  const colW = Math.floor(
    (screenW - SCREEN_PAD * 2 - ARROW_GAP * 2 - CENTER_W) / 2
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchSupplyChain(symbol);
      setGraph(data);
    } catch (e) {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    load();
  }, [load]);

  // Open the Stock Detail page for a company that exists in the app.
  // push (not navigate) so back returns here, even if we came from a
  // StockDetail screen that is already in the stack.
  const openNode = (node) => {
    const inst = INSTRUMENT_BY_SYMBOL[node.symbol];
    if (!inst) return;
    navigation.push("StockDetail", {
      instrumentKey: inst.key,
      symbol: inst.symbol,
      name: inst.name,
      sector: inst.sector ?? "Equity",
      domain: inst.domain,
    });
  };

  const suppliers = graph?.suppliers ?? [];
  const customers = graph?.customers ?? [];
  const hasData = graph && (suppliers.length > 0 || customers.length > 0);
  const centreName = graph?.company?.name || name || symbol;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Ionicons
            name="arrow-back"
            size={moderateScale(20)}
            color={Colors.text}
          />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Supply Chain</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {symbol}
          </Text>
        </View>
      </View>

      {/* ── Loading ─────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : error ? (
        /* ── Request failed ─────────────────────────────────────────────── */
        <View style={styles.centerState}>
          <Ionicons
            name="cloud-offline-outline"
            size={moderateScale(44)}
            color={Colors.textMuted}
          />
          <Text style={styles.stateTitle}>Couldn't load supply chain</Text>
          <Text style={styles.stateText}>Check your connection and try again.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : !hasData ? (
        /* ── No data in DB ──────────────────────────────────────────────── */
        <View style={styles.centerState}>
          <Ionicons
            name="git-network-outline"
            size={moderateScale(44)}
            color={Colors.textMuted}
          />
          <Text style={styles.stateTitle}>No data in DB</Text>
          <Text style={styles.stateText}>
            We don't have supply chain data for {centreName} yet.
          </Text>
        </View>
      ) : (
        /* ── Graph ──────────────────────────────────────────────────────── */
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          {/* column titles */}
          <View style={styles.titleRow}>
            <Text style={[styles.colTitle, { width: colW }]}>SUPPLIERS</Text>
            <View style={{ width: ARROW_GAP * 2 + CENTER_W }} />
            <Text style={[styles.colTitle, { width: colW }]}>CUSTOMERS</Text>
          </View>

          <View style={styles.graphRow}>
            {/* LEFT — suppliers */}
            <View style={styles.column}>
              {suppliers.length > 0 ? (
                suppliers.map((n, i) => (
                  <Node
                    key={`s-${n.name}-${n.item}-${i}`}
                    node={n}
                    width={colW}
                    onPress={openNode}
                  />
                ))
              ) : (
                <EmptySide width={colW} label="No suppliers on record" />
              )}
            </View>

            <View style={styles.arrowCol}>
              <Ionicons
                name="arrow-forward"
                size={moderateScale(16)}
                color={Colors.textMuted}
              />
            </View>

            {/* CENTRE — this stock */}
            <View style={styles.centreBox}>
              <Text style={styles.centreSymbol}>{symbol}</Text>
              <Text style={styles.centreName} numberOfLines={4}>
                {centreName}
              </Text>
            </View>

            <View style={styles.arrowCol}>
              <Ionicons
                name="arrow-forward"
                size={moderateScale(16)}
                color={Colors.textMuted}
              />
            </View>

            {/* RIGHT — customers */}
            <View style={styles.column}>
              {customers.length > 0 ? (
                customers.map((n, i) => (
                  <Node
                    key={`c-${n.name}-${n.item}-${i}`}
                    node={n}
                    width={colW}
                    onPress={openNode}
                  />
                ))
              ) : (
                <EmptySide width={colW} label="No customers on record" />
              )}
            </View>
          </View>

          {/* legend */}
          <View style={styles.legend}>
            <Text style={styles.legendHint}>
              Tap a highlighted company to open its stock page.
            </Text>
            <View style={styles.legendRow}>
              {["HIGH", "MEDIUM", "LOW"].map((c) => (
                <View key={c} style={styles.legendItem}>
                  <View
                    style={[styles.confDot, { backgroundColor: CONFIDENCE_COLOR[c] }]}
                  />
                  <Text style={styles.legendText}>
                    {c.charAt(0) + c.slice(1).toLowerCase()} confidence
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

export default SupplyChainPage;

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: "row",
    alignItems: "center",
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
    marginRight: moderateScale(12),
  },
  headerTitle: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
    marginTop: 1,
  },

  scroll: {
    paddingHorizontal: SCREEN_PAD,
    paddingTop: moderateScale(8),
    paddingBottom: moderateScale(40),
  },

  // column titles
  titleRow: { flexDirection: "row", marginBottom: moderateScale(8) },
  colTitle: {
    fontSize: fontScale(Typography.tiny),
    fontWeight: "700",
    color: Colors.textMuted,
    letterSpacing: 0.8,
    textAlign: "center",
  },

  // graph
  graphRow: { flexDirection: "row", alignItems: "center" },
  column: { gap: moderateScale(8) },
  arrowCol: {
    width: ARROW_GAP,
    alignItems: "center",
    justifyContent: "center",
  },

  node: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: moderateScale(10),
    paddingVertical: moderateScale(8),
    paddingHorizontal: moderateScale(8),
  },
  nodeTappable: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  nodeName: {
    fontSize: fontScale(Typography.small),
    fontWeight: "700",
    color: Colors.text,
  },
  nodeItem: {
    fontSize: fontScale(Typography.tiny),
    color: Colors.textSecondary,
    marginTop: 2,
  },
  nodeFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: moderateScale(6),
    minHeight: moderateScale(13),
  },
  nodeEmpty: {
    borderStyle: "dashed",
    backgroundColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
    minHeight: moderateScale(60),
  },
  nodeEmptyText: {
    fontSize: fontScale(Typography.tiny),
    color: Colors.textMuted,
    textAlign: "center",
  },
  confDot: { width: 7, height: 7, borderRadius: 4 },

  // centre
  centreBox: {
    width: CENTER_W,
    backgroundColor: Colors.primary,
    borderRadius: moderateScale(14),
    paddingVertical: moderateScale(14),
    paddingHorizontal: moderateScale(8),
    alignItems: "center",
  },
  centreSymbol: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "800",
    color: Colors.white,
  },
  centreName: {
    fontSize: fontScale(Typography.tiny),
    color: Colors.primaryLight,
    textAlign: "center",
    marginTop: 4,
  },

  // legend
  legend: { marginTop: moderateScale(24), alignItems: "center" },
  legendHint: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
    textAlign: "center",
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: moderateScale(14),
    marginTop: moderateScale(10),
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { fontSize: fontScale(Typography.tiny), color: Colors.textMuted },

  // states
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: moderateScale(32),
    paddingBottom: moderateScale(60),
  },
  stateTitle: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
    marginTop: moderateScale(14),
  },
  stateText: {
    fontSize: fontScale(Typography.caption),
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: moderateScale(6),
  },
  retryBtn: {
    marginTop: moderateScale(18),
    paddingHorizontal: moderateScale(24),
    paddingVertical: moderateScale(10),
    borderRadius: moderateScale(10),
    backgroundColor: Colors.primary,
  },
  retryText: { color: Colors.white, fontWeight: "700" },
});