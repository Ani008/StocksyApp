import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

// ─── Reusing existing component — no new component needed ────────────────────
import WatchlistItem from "../components/WatchlistItem";

// ─── Live prices hook — same one Dashboard uses ──────────────────────────────
import useMarketData from "../hooks/useMarketData";

import { Colors, Typography, Shadows, fontScale, moderateScale } from "../theme";

// ─── Static instrument metadata ──────────────────────────────────────────────
// This is the client-side mirror of config/instruments.js on the backend.
// Keys must exactly match what Python saves to Redis (Section 9.2 of backend docs).
// Used for name/symbol search — prices come from the WebSocket hook.
//
// Why keep this here and not fetch from an API?
// All 50 instruments are known at build time. Shipping them as a constant means:
//   - Zero network requests for search
//   - Works offline / before WebSocket connects
//   - No server cost per keystroke
export const INSTRUMENTS = [
  {
    key: "NSE_INDEX|Nifty 50",
    symbol: "NIFTY 50",
    name: "Nifty 50 Index",
    domain: "nseindia.com",
    sector: "Index",
  },
  {
    key: "NSE_INDEX|Nifty Bank",
    symbol: "BANK NIFTY",
    name: "Nifty Bank Index",
    domain: "nseindia.com",
    sector: "Index",
  },
  {
    key: "NSE_EQ|INE040A01034",
    symbol: "HDFCBANK",
    name: "HDFC Bank Ltd",
    domain: "hdfcbank.com",
    sector: "Banking",
  },
  {
    key: "NSE_EQ|INE090A01021",
    symbol: "ICICIBANK",
    name: "ICICI Bank Ltd",
    domain: "icicibank.com",
    sector: "Banking",
  },
  {
    key: "NSE_EQ|INE062A01020",
    symbol: "SBIN",
    name: "State Bank of India",
    domain: "sbi.co.in",
    sector: "Banking",
  },
  {
    key: "NSE_EQ|INE238A01034",
    symbol: "AXISBANK",
    name: "Axis Bank Ltd",
    domain: "axisbank.com",
    sector: "Banking",
  },
  {
    key: "NSE_EQ|INE296A01032",
    symbol: "BAJFINANCE",
    name: "Bajaj Finance Ltd",
    domain: "bajajfinserv.in",
    sector: "Banking",
  },
  {
    key: "NSE_EQ|INE237A01036",
    symbol: "KOTAKBANK",
    name: "Kotak Mahindra Bank",
    domain: "kotak.com",
    sector: "Banking",
  },
  {
    key: "NSE_EQ|INE795G01014",
    symbol: "HDFCLIFE",
    name: "HDFC Life Insurance",
    domain: "hdfclife.com",
    sector: "Insurance",
  },
  {
    key: "NSE_EQ|INE467B01029",
    symbol: "TCS",
    name: "Tata Consultancy Services",
    domain: "tcs.com",
    sector: "IT",
  },
  {
    key: "NSE_EQ|INE009A01021",
    symbol: "INFY",
    name: "Infosys Ltd",
    domain: "infosys.com",
    sector: "IT",
  },
  {
    key: "NSE_EQ|INE075A01022",
    symbol: "WIPRO",
    name: "Wipro Ltd",
    domain: "wipro.com",
    sector: "IT",
  },
  {
    key: "NSE_EQ|INE860A01027",
    symbol: "HCLTECH",
    name: "HCL Technologies Ltd",
    domain: "hcltech.com",
    sector: "IT",
  },
  {
    key: "NSE_EQ|INE669C01036",
    symbol: "TECHM",
    name: "Tech Mahindra Ltd",
    domain: "techmahindra.com",
    sector: "IT",
  },
  {
    key: "NSE_EQ|INE214T01019",
    symbol: "LTIM",
    name: "LTIMindtree Ltd",
    domain: "ltimindtree.com",
    sector: "IT",
  },
  {
    key: "NSE_EQ|INE002A01018",
    symbol: "RELIANCE",
    name: "Reliance Industries Ltd",
    domain: "ril.com",
    sector: "Energy",
  },
  {
    key: "NSE_EQ|INE213A01029",
    symbol: "ONGC",
    name: "Oil & Natural Gas Corp",
    domain: "ongcindia.com",
    sector: "Energy",
  },
  {
    key: "NSE_EQ|INE029A01011",
    symbol: "BPCL",
    name: "Bharat Petroleum Corp",
    domain: "bharatpetroleum.in",
    sector: "Energy",
  },
  {
    key: "NSE_EQ|INE752E01010",
    symbol: "POWERGRID",
    name: "Power Grid Corp of India",
    domain: "powergridindia.com",
    sector: "Energy",
  },
  {
    key: "NSE_EQ|INE733E01010",
    symbol: "NTPC",
    name: "NTPC Ltd",
    domain: "ntpc.co.in",
    sector: "Energy",
  },
  {
    key: "NSE_EQ|INE585B01010",
    symbol: "MARUTI",
    name: "Maruti Suzuki India Ltd",
    domain: "marutisuzuki.com",
    sector: "Auto",
  },
  {
    key: "NSE_EQ|INE1TAE01010",
    symbol: "TATAMOTORS",
    name: "Tata Motors Ltd",
    domain: "tatamotors.com",
    sector: "Auto",
  },
  {
    key: "NSE_EQ|INE917I01010",
    symbol: "BAJAJ-AUTO",
    name: "Bajaj Auto Ltd",
    domain: "bajajauto.com",
    sector: "Auto",
  },
  {
    key: "NSE_EQ|INE066A01021",
    symbol: "EICHERMOT",
    name: "Eicher Motors Ltd",
    domain: "eichermotors.com",
    sector: "Auto",
  },
  {
    key: "NSE_EQ|INE158A01026",
    symbol: "HEROMOTOCO",
    name: "Hero MotoCorp Ltd",
    domain: "heromotocorp.com",
    sector: "Auto",
  },
  {
    key: "NSE_EQ|INE030A01027",
    symbol: "HINDUNILVR",
    name: "Hindustan Unilever Ltd",
    domain: "hul.co.in",
    sector: "FMCG",
  },
  {
    key: "NSE_EQ|INE154A01025",
    symbol: "ITC",
    name: "ITC Ltd",
    domain: "itcportal.com",
    sector: "FMCG",
  },
  {
    key: "NSE_EQ|INE239A01024",
    symbol: "NESTLEIND",
    name: "Nestle India",
    domain: "nestle.in",
    sector: "FMCG",
  },
  {
    key: "NSE_EQ|INE016A01026",
    symbol: "DABUR",
    name: "Dabur India Ltd",
    domain: "dabur.com",
    sector: "FMCG",
  },
  {
    key: "NSE_EQ|INE216A01030",
    symbol: "BRITANNIA",
    name: "Britannia Industries Ltd",
    domain: "britannia.co.in",
    sector: "FMCG",
  },
  {
    key: "NSE_EQ|INE044A01036",
    symbol: "SUNPHARMA",
    name: "Sun Pharmaceutical",
    domain: "sunpharma.com",
    sector: "Pharma",
  },
  {
    key: "NSE_EQ|INE089A01031",
    symbol: "DRREDDY",
    name: "Dr. Reddy's Laboratories",
    domain: "drreddys.com",
    sector: "Pharma",
  },
  {
    key: "NSE_EQ|INE059A01026",
    symbol: "CIPLA",
    name: "Cipla Ltd",
    domain: "cipla.com",
    sector: "Pharma",
  },
  {
    key: "NSE_EQ|INE361B01024",
    symbol: "DIVISLAB",
    name: "Divi's Laboratories",
    domain: "divislabs.com",
    sector: "Pharma",
  },
  {
    key: "NSE_EQ|INE081A01020",
    symbol: "TATASTEEL",
    name: "Tata Steel Ltd",
    domain: "tatasteel.com",
    sector: "Metals",
  },
  {
    key: "NSE_EQ|INE038A01020",
    symbol: "HINDALCO",
    name: "Hindalco Industries",
    domain: "hindalco.com",
    sector: "Metals",
  },
  {
    key: "NSE_EQ|INE019A01038",
    symbol: "JSWSTEEL",
    name: "JSW Steel Ltd",
    domain: "jsw.in",
    sector: "Metals",
  },
  {
    key: "NSE_EQ|INE522F01014",
    symbol: "COALINDIA",
    name: "Coal India Ltd",
    domain: "coalindia.in",
    sector: "Metals",
  },
  {
    key: "NSE_EQ|INE397D01024",
    symbol: "BHARTIARTL",
    name: "Bharti Airtel Ltd",
    domain: "airtel.in",
    sector: "Telecom",
  },
  {
    key: "NSE_EQ|INE742F01042",
    symbol: "ADANIPORTS",
    name: "Adani Ports & SEZ",
    domain: "adaniports.com",
    sector: "Infrastructure",
  },
  {
    key: "NSE_EQ|INE364U01010",
    symbol: "ADANIGREEN",
    name: "Adani Green Energy",
    domain: "adanigreenenergy.com",
    sector: "Energy",
  },
  {
    key: "NSE_EQ|INE481G01011",
    symbol: "ULTRACEMCO",
    name: "UltraTech Cement Ltd",
    domain: "ultratechcement.com",
    sector: "Cement",
  },
  {
    key: "NSE_EQ|INE018A01030",
    symbol: "LT",
    name: "Larsen & Toubro Ltd",
    domain: "larsentoubro.com",
    sector: "Infrastructure",
  },
  {
    key: "NSE_EQ|INE047A01021",
    symbol: "GRASIM",
    name: "Grasim Industries",
    domain: "grasim.com",
    sector: "Chemicals",
  },
  {
    key: "NSE_EQ|INE423A01024",
    symbol: "ADANIENT",
    name: "Adani Enterprises Ltd",
    domain: "adanienterprises.com",
    sector: "Conglomerate",
  },
  {
    key: "NSE_EQ|INE1NPP01017",
    symbol: "SIEMENS",
    name: "Siemens Ltd",
    domain: "siemens.co.in",
    sector: "Infrastructure",
  },

  {
    key: "NSE_EQ|INE205A01025",
    symbol: "VEDL",
    name: "Vedanta Ltd",
    domain: "vedanta-zincinternational.com",
    sector: "Mining & Metals",
  },
  {
    key: "NSE_EQ|INE263A01024",
    symbol: "BEL",
    name: "Bharat Electronics Ltd",
    domain: "bel-india.in",
    sector: "Defense",
  },
  {
    key: "NSE_EQ|INE053F01010",
    symbol: "IRFC",
    name: "Indian Railway Finance Corporation",
    domain: "irfc.co.in",
    sector: "Financial Services",
  },
  {
    key: "NSE_EQ|INE040H01021",
    symbol: "SUZLON",
    name: "Suzlon Energy Ltd",
    domain: "suzlon.de",
    sector: "Renewable Energy",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Formats a live price number to ₹ string */
const formatPrice = (ltp) =>
  ltp != null ? `₹${ltp.toLocaleString("en-IN")}` : "—";

/** Computes % change label + direction from ltp and close price */
const calcChange = (ltp, cp) => {
  if (!ltp || !cp || cp === 0) return { label: undefined, isPositive: true };
  const pct = ((ltp - cp) / cp) * 100;
  return {
    label: `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%`,
    isPositive: pct >= 0,
  };
};

// ─── Component ───────────────────────────────────────────────────────────────

const SearchPage = ({ navigation }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Same hook Dashboard uses — no duplicate WebSocket connections
  const { prices } = useMarketData();

  // ── Debounce timer ref ────────────────────────────────────────────────────
  // Why debounce?
  //   Without it, every keystroke triggers a filter loop over 50 items.
  //   With debounce (300ms), the filter only runs once the user pauses typing.
  //   This is the standard pattern to avoid hammering logic on every character.
  //   300ms is the sweet spot — fast enough to feel instant, slow enough to batch.
  const debounceTimer = useRef(null);

  // ── Search logic ──────────────────────────────────────────────────────────
  // Why client-side and not a server API?
  //   All 50 instruments are already known — they're in the INSTRUMENTS constant
  //   above and their live prices arrive via the existing WebSocket.
  //   Sending a search query to the server for every keystroke would mean:
  //     - A new HTTP request per search (latency + server cost)
  //     - Server needs to query Redis or a DB just to filter 50 known items
  //   Client-side search on 50 items is instant and costs nothing to deploy.
  const runSearch = useCallback(
    (text) => {
      const q = text.trim().toLowerCase();

      if (!q) {
        setResults([]);
        setIsSearching(false);
        return;
      }

      // Filter: match on symbol OR name — case insensitive
      const filtered = INSTRUMENTS.filter(
        (inst) =>
          inst.symbol.toLowerCase().includes(q) ||
          inst.name.toLowerCase().includes(q) ||
          inst.sector.toLowerCase().includes(q),
      );

      setResults(filtered);
      setIsSearching(false);
    },
    [], // no deps — INSTRUMENTS is a module-level constant
  );

  // ── Debounced handler — called on every keystroke ─────────────────────────
  const handleQueryChange = (text) => {
    setQuery(text);

    // Show spinner immediately so the UI feels responsive
    if (text.trim()) setIsSearching(true);
    else setIsSearching(false);

    // Clear any pending timer, then set a new one
    // The search only fires 300ms after the user stops typing
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => runSearch(text), 300);
  };

  // Cleanup timer on unmount to prevent memory leaks
  useEffect(() => {
    return () => clearTimeout(debounceTimer.current);
  }, []);

  // ── Render each result row ────────────────────────────────────────────────
  // Reuses WatchlistItem — it already renders logo, name, price, change badge.
  // We just enrich the static instrument metadata with live price from the hook.
  const renderItem = ({ item }) => {
    const liveData = prices[item.key]; // may be undefined if WS not connected yet
    const { label: changeLabel, isPositive } = calcChange(
      liveData?.ltp,
      liveData?.cp,
    );

    return (
      <WatchlistItem
        ticker={item.symbol}
        name={item.name}
        price={formatPrice(liveData?.ltp)}
        change={changeLabel}
        isPositive={isPositive}
        logoUrl={`https://img.logo.dev/${item.domain}?token=pk_Bym4BAakTJudMK4MGnfpnw`}
        onPress={() =>
          navigation.navigate("StockDetail", {
            instrumentKey: item.key,
            symbol: item.symbol,
            name: item.name,
            sector: item.sector,
            domain: item.domain,
          })
        }
      />
    );
  };

  // ── Empty / placeholder states ────────────────────────────────────────────
  const renderEmpty = () => {
    if (!query.trim()) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="search-outline" size={moderateScale(48)} color={Colors.borderLight} />
          <Text style={styles.emptyTitle}>Search stocks & indices</Text>
          <Text style={styles.emptySubtitle}>
            Try "Reliance", "IT", "INFY" or "Banking"
          </Text>
        </View>
      );
    }
    if (!isSearching && results.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={moderateScale(48)} color={Colors.borderLight} />
          <Text style={styles.emptyTitle}>No results for "{query}"</Text>
          <Text style={styles.emptySubtitle}>
            Try a ticker symbol, company name, or sector
          </Text>
        </View>
      );
    }
    return null;
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={moderateScale(22)} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Search</Text>
      </View>

      {/* ── Search Input ─────────────────────────────────────────────────── */}
      <View style={styles.searchBarWrapper}>
        <View style={styles.searchBar}>
          <Ionicons
            name="search-outline"
            size={moderateScale(18)}
            color={Colors.textMuted}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.input}
            placeholder="Symbol, company or sector..."
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={handleQueryChange}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {/* Spinner while debounce timer is pending */}
          {isSearching && (
            <ActivityIndicator
              size="small"
              color={Colors.primary}
              style={{ marginRight: moderateScale(4) }}
            />
          )}
          {/* Clear button */}
          {query.length > 0 && !isSearching && (
            <TouchableOpacity
              onPress={() => {
                setQuery("");
                setResults([]);
              }}
            >
              <Ionicons name="close-circle" size={moderateScale(18)} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Result count badge ───────────────────────────────────────────── */}
      {results.length > 0 && (
        <Text style={styles.resultCount}>
          {results.length} result{results.length !== 1 ? "s" : ""}
        </Text>
      )}

      {/* ── Results List ─────────────────────────────────────────────────── */}
      {/* FlatList over ScrollView — virtualized so only visible rows render.
          For 50 items it doesn't matter much, but it's the correct pattern
          for any list that could grow. */}
      <FlatList
        data={results}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled" // tapping a result doesn't dismiss keyboard first
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(8),
    gap: moderateScale(12),
  },
  backButton: {
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: moderateScale(12),
    backgroundColor: Colors.divider,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: fontScale(Typography.h3),
    fontWeight: "bold",
    color: Colors.text,
  },

  // ── Search Bar ──────────────────────────────────────────────────────────────
  searchBarWrapper: {
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(8),
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.white,
    borderRadius: moderateScale(14),
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(12),
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  searchIcon: { marginRight: moderateScale(8) },
  input: {
    flex: 1,
    fontSize: fontScale(Typography.body),
    color: Colors.text,
    padding: moderateScale(0), // removes default Android padding
  },

  // ── Result count ────────────────────────────────────────────────────────────
  resultCount: {
    fontSize: fontScale(Typography.small),
    color: Colors.textMuted,
    fontWeight: "600",
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(8),
  },

  // ── List ────────────────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(40),
    flexGrow: 1,
  },

  // ── Empty state ─────────────────────────────────────────────────────────────
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: moderateScale(80),
    gap: moderateScale(10),
  },
  emptyTitle: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.textSecondary,
    marginTop: moderateScale(8),
  },
  emptySubtitle: {
    fontSize: fontScale(Typography.caption),
    color: Colors.textMuted,
    textAlign: "center",
    paddingHorizontal: moderateScale(32),
  },
});

export default SearchPage;