import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import OrderRow from "../components/OrderRow";
import SegmentedToggle from "../components/SegmentedToggle";
import FilterTabs from "../components/FilterTabs";
import { fetchOrders } from "../../services/orderService";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

// Status tabs. Every order lands in exactly one: anything still working
// (PENDING / OPEN / PARTIALLY_FILLED, and any status we don't recognise) is
// "Open"; FILLED is "Filled"; CANCELLED and REJECTED are "Cancelled" (rejected
// rows keep their red badge).
const FILTERS = [
  { key: "OPEN", label: "Open" },
  { key: "FILLED", label: "Filled" },
  { key: "CANCELLED", label: "Cancelled" },
];

const bucketOf = (order) => {
  if (order.status === "FILLED") return "FILLED";
  if (order.status === "CANCELLED" || order.status === "REJECTED") return "CANCELLED";
  return "OPEN";
};

const EMPTY_COPY = {
  OPEN: "Orders still waiting to fill, like limit and stop-loss orders, show up here.",
  FILLED: "Orders that have been executed will be listed here.",
  CANCELLED: "Cancelled and rejected orders will be listed here.",
};

const OrderHistoryPage = ({ navigation }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Same Delivery (CNC) / Intraday (MIS) split used on the Dashboard's
  // Total Assets card — orders carry the same product_type field as
  // positions do, so it maps 1:1.
  const [productTab, setProductTab] = useState("delivery");

  // Status tab. Starts on "Filled" (where most orders end up); once the first
  // load finishes it jumps to "Open" if any order is still working, so a
  // pending order is the first thing you see rather than something to hunt for.
  const [statusTab, setStatusTab] = useState("FILLED");
  const pickedDefaultTab = useRef(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await fetchOrders(200);
      setOrders(data || []);
    } catch (err) {
      // Global toast already covers this.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh whenever this screen regains focus — a freshly placed order
  // should show up without the person needing to pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const deliveryOrders = useMemo(
    () => orders.filter((o) => o.product_type !== "MIS"),
    [orders]
  );
  const intradayOrders = useMemo(
    () => orders.filter((o) => o.product_type === "MIS"),
    [orders]
  );
  const productOrders = productTab === "delivery" ? deliveryOrders : intradayOrders;

  useEffect(() => {
    if (loading || pickedDefaultTab.current) return;
    pickedDefaultTab.current = true;
    if (orders.some((o) => bucketOf(o) === "OPEN")) setStatusTab("OPEN");
  }, [loading, orders]);

  const counts = useMemo(() => {
    const c = { OPEN: 0, FILLED: 0, CANCELLED: 0 };
    for (const o of productOrders) c[bucketOf(o)] += 1;
    return c;
  }, [productOrders]);

  const activeOrders = useMemo(
    () => productOrders.filter((o) => bucketOf(o) === statusTab),
    [productOrders, statusTab]
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.gain} />
        <Text style={styles.loadingText}>Loading your orders…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surfaceAlt} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={moderateScale(20)} color={Colors.text} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Order History</Text>

        <View style={styles.headerBtn} />
      </View>

      <View style={styles.toggleRow}>
        <SegmentedToggle
          theme="neutral"
          value={productTab}
          onChange={setProductTab}
          options={[
            { key: "delivery", label: `Delivery${deliveryOrders.length ? ` (${deliveryOrders.length})` : ""}` },
            { key: "intraday", label: `Intraday${intradayOrders.length ? ` (${intradayOrders.length})` : ""}` },
          ]}
        />
      </View>

      <View style={styles.tabsRow}>
        <FilterTabs
          value={statusTab}
          onChange={setStatusTab}
          options={FILTERS.map((f) => ({ ...f, count: counts[f.key] }))}
        />
      </View>

      <FlatList
        data={activeOrders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => <OrderRow order={item} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={Colors.gain}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIconRing}>
              <Ionicons
                name="document-text-outline"
                size={moderateScale(28)}
                color={Colors.textMuted}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {productOrders.length === 0
                ? `No ${productTab === "delivery" ? "delivery" : "intraday"} orders yet`
                : `No ${statusTab.toLowerCase()} ${productTab === "delivery" ? "delivery" : "intraday"} orders`}
            </Text>
            <Text style={styles.emptySubtitle}>
              {productOrders.length === 0
                ? "Every order you place will show up here — filled, open, or cancelled."
                : EMPTY_COPY[statusTab]}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surfaceAlt },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.surfaceAlt,
  },
  loadingText: {
    marginTop: moderateScale(12),
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.caption),
  },
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
    marginBottom: moderateScale(10),
  },
  tabsRow: {
    paddingHorizontal: moderateScale(20),
    marginBottom: moderateScale(14),
  },
  listContent: {
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(40),
    flexGrow: 1,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: moderateScale(60),
    gap: moderateScale(8),
  },
  emptyIconRing: {
    width: moderateScale(60),
    height: moderateScale(60),
    borderRadius: moderateScale(30),
    backgroundColor: Colors.background,
    borderWidth: 1.5,
    borderColor: Colors.border,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: moderateScale(4),
  },
  emptyTitle: {
    fontSize: fontScale(Typography.body),
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  emptySubtitle: {
    fontSize: fontScale(Typography.caption),
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: moderateScale(20),
    paddingHorizontal: moderateScale(24),
  },
});

export default OrderHistoryPage;
