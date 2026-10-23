import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { INSTRUMENTS } from "./SearchPage";
import { pickMatchup, ROUNDS_PER_DAY } from "../utils/stockOfTheDay";
import { Colors, Shadows, Typography, fontScale, moderateScale } from "../theme";

const LOGO_TOKEN = "pk_Bym4BAakTJudMK4MGnfpnw"; // same public logo.dev key used across the app
const logoUri = (domain) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}`;

/**
 * One big tappable company logo.
 *
 * Stage 1: tapping only highlights the choice (local state). Stage 2 turns this
 * into a real vote.
 */
function LogoButton({ stock, selected, dimmed, onPress, size }) {
  const scale = useRef(new Animated.Value(1)).current;
  const [failed, setFailed] = useState(false);

  const pressTo = (to) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 30, bounciness: 8 }).start();

  return (
    <Animated.View style={{ transform: [{ scale }], opacity: dimmed ? 0.45 : 1 }}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onPress}
        onPressIn={() => pressTo(0.94)}
        onPressOut={() => pressTo(1)}
        accessibilityRole="button"
        accessibilityLabel={`Pick ${stock.name}`}
        accessibilityState={{ selected }}
        style={[
          styles.logoCard,
          { width: size, height: size },
          selected && styles.logoCardSelected,
        ]}
      >
        {failed ? (
          <Text style={styles.fallback}>{stock.symbol.slice(0, 2).toUpperCase()}</Text>
        ) : (
          <Image
            source={{ uri: logoUri(stock.domain) }}
            style={{ width: size * 0.62, height: size * 0.62 }}
            resizeMode="contain"
            onError={() => setFailed(true)}
          />
        )}
        {selected && (
          <View style={styles.tick}>
            <Ionicons name="checkmark" size={moderateScale(14)} color="#fff" />
          </View>
        )}
      </TouchableOpacity>
      <Text style={styles.stockName} numberOfLines={2}>
        {stock.name}
      </Text>
    </Animated.View>
  );
}

/**
 * Stock of the Day (Stage 1).
 *
 * Picks today's sector and one head-to-head matchup from it, shows both logos
 * big, with the question on top. The pick is seeded by the IST date, so every
 * user sees the same matchup today.
 */
const StockOfTheDayPage = ({ navigation }) => {
  // Dev only: lets you re-roll the draw without waiting for tomorrow.
  const [salt, setSalt] = useState("");
  const [choice, setChoice] = useState(null); // "left" | "right" | null
  const [rowWidth, setRowWidth] = useState(0);

  const matchup = useMemo(() => pickMatchup(INSTRUMENTS, { salt }), [salt]);

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("MainTabs");
  };

  const shuffle = useCallback(() => {
    setChoice(null);
    setSalt(String(Date.now()));
  }, []);

  // Two logos side by side with a gap in the middle for the VS badge.
  const gap = moderateScale(20);
  const size = rowWidth > 0 ? Math.floor((rowWidth - gap) / 2) : 0;

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
        <Text style={styles.headerTitle}>Stock of the Day</Text>
        <View style={styles.headerBtn} />
      </View>

      {!matchup ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No matchup today</Text>
          <Text style={styles.emptyBody}>We couldn't find enough stocks to pit against each other.</Text>
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.chipRow}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{matchup.sector.toUpperCase()}</Text>
            </View>
            <Text style={styles.round}>
              Round {matchup.round + 1} of {ROUNDS_PER_DAY}
            </Text>
          </View>

          <Text style={styles.question} accessibilityRole="header">
            {matchup.question.text}
          </Text>

          <View
            style={styles.row}
            onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
          >
            {size > 0 && (
              <>
                <LogoButton
                  stock={matchup.left}
                  size={size}
                  selected={choice === "left"}
                  dimmed={choice === "right"}
                  onPress={() => setChoice("left")}
                />
                <LogoButton
                  stock={matchup.right}
                  size={size}
                  selected={choice === "right"}
                  dimmed={choice === "left"}
                  onPress={() => setChoice("right")}
                />
                <View pointerEvents="none" style={[styles.vsWrap, { top: size / 2 - moderateScale(20) }]}>
                  <View style={styles.vs}>
                    <Text style={styles.vsText}>VS</Text>
                  </View>
                </View>
              </>
            )}
          </View>

          <Text style={styles.hint}>
            {choice ? "Locked in for now. Voting goes live soon." : "Tap a logo to pick your winner"}
          </Text>

          {__DEV__ && (
            <TouchableOpacity onPress={shuffle} style={styles.devBtn} accessibilityRole="button">
              <Ionicons name="shuffle" size={moderateScale(16)} color={Colors.textSecondary} />
              <Text style={styles.devText}>Shuffle (dev only)</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
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
  body: {
    flex: 1,
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(8),
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chip: {
    backgroundColor: "#FEF3C7",
    borderRadius: moderateScale(8),
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(4),
  },
  chipText: {
    color: "#92400E",
    fontSize: fontScale(11),
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  round: {
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.small),
    fontWeight: "600",
  },
  question: {
    color: Colors.text,
    fontSize: fontScale(26),
    lineHeight: fontScale(32),
    fontWeight: "800",
    letterSpacing: -0.5,
    textAlign: "center",
    marginTop: moderateScale(28),
    marginBottom: moderateScale(32),
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  logoCard: {
    backgroundColor: Colors.surface,
    borderRadius: moderateScale(28),
    borderWidth: 2,
    borderColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
    ...Shadows.card,
  },
  logoCardSelected: {
    borderColor: Colors.primary,
  },
  fallback: {
    color: Colors.textSecondary,
    fontSize: fontScale(40),
    fontWeight: "800",
  },
  tick: {
    position: "absolute",
    top: moderateScale(10),
    right: moderateScale(10),
    width: moderateScale(24),
    height: moderateScale(24),
    borderRadius: moderateScale(12),
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  stockName: {
    marginTop: moderateScale(10),
    textAlign: "center",
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.small),
    fontWeight: "600",
  },
  vsWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  vs: {
    width: moderateScale(40),
    height: moderateScale(40),
    borderRadius: moderateScale(20),
    backgroundColor: Colors.text,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: Colors.background,
  },
  vsText: {
    color: "#fff",
    fontSize: fontScale(12),
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  hint: {
    textAlign: "center",
    color: Colors.textMuted,
    fontSize: fontScale(Typography.small),
    marginTop: moderateScale(28),
  },
  devBtn: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(6),
    marginTop: moderateScale(24),
    padding: moderateScale(8),
  },
  devText: {
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.small),
    fontWeight: "600",
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: moderateScale(32),
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
  },
  emptyBody: {
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.body),
    textAlign: "center",
    marginTop: moderateScale(8),
  },
});

export default StockOfTheDayPage;
