import React from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Colors, Typography, fontScale, moderateScale } from "../theme";

/**
 * MiniHoldingCard — Small holding chip inside the Total Assets card.
 *
 * Props:
 *   ticker      string (required)  — Ticker label. e.g. "NIFTY 50"
 *   name        string (required)  — Company name or live price. e.g. "₹23,892"
 *   change      string             — Change string. e.g. "▲ 1.76%"
 *   isPositive  boolean            — Controls change color.
 *   logoUrl     string             — Image URL for logo (takes priority over iconName).
 *   iconName    string             — Ionicons icon name (fallback if no logoUrl).
 *   iconColor   string             — Icon color (only used when falling back to Ionicons).
 *   onPress     function           — Optional. If provided, the card becomes tappable
 *                                    (e.g. navigate to StockDetail). Omit for
 *                                    display-only usages like the index tiles.
 */
const MiniHoldingCard = ({
  ticker,
  name,
  change,
  isPositive = true,
  logoUrl,
  iconName = "bar-chart-outline",
  iconColor = Colors.text,
  onPress,
}) => {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      style={styles.card}
      {...(onPress ? { onPress, activeOpacity: 0.8 } : {})}
    >
      <View style={styles.iconBox}>
        {logoUrl ? (
          <Image source={{ uri: logoUrl }} style={styles.logo} />
        ) : (
          <Ionicons name={iconName} size={18} color={iconColor} />
        )}
      </View>
      <View style={styles.text}>
        <Text style={styles.ticker} numberOfLines={1} ellipsizeMode="tail">
          {ticker}
        </Text>
        <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
          {name}
        </Text>
      </View>
      {change ? (
        <Text
          style={[styles.change, { color: isPositive ? Colors.success : Colors.danger }]}
          numberOfLines={1}
        >
          {change}
        </Text>
      ) : null}
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",

    padding: moderateScale(12),

    backgroundColor: Colors.white,

    borderRadius: 14,

    borderWidth: 1,
    borderColor: Colors.divider,

    shadowColor: Colors.text,
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.06,
    shadowRadius: 8,

    elevation: 3,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,

    backgroundColor: Colors.white,

    justifyContent: "center",
    alignItems: "center",

    borderWidth: 1,
    borderColor: Colors.divider,

    shadowColor: Colors.black,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,

    elevation: 2,

    overflow: "hidden",
  },
  logo: {
    width: 32,
    height: 32,
  },
  text: { flex: 1, minWidth: 0, marginLeft: moderateScale(8) },
  // Suggested Style Changes
  ticker: {
    fontSize: fontScale(8),
    fontWeight: "600", // Slightly less heavy than 'bold'
    color: Colors.textSecondary, // Soft slate/gray color
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  name: {
    fontSize: fontScale(Typography.caption), // Bumped up slightly
    color: Colors.black, // True black for importance
    fontWeight: "700", // Heavy bold
  },
  change: { fontSize: fontScale(5), fontWeight: "600", flexShrink: 0, marginLeft: moderateScale(4) },
});

export default MiniHoldingCard;