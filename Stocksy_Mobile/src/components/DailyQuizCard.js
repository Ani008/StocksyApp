import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import StockQuizIllustration from "./StockQuizIllustration";
import { Colors, Shadows, fontScale, moderateScale } from "../theme";

// Baby pink, light to a touch deeper (top-left to bottom-right).
const PINK_LIGHT = "#FFE4EC";
const PINK_DEEP = "#FBCFE0";

/**
 * DailyQuizCard — the square "Daily Quiz" widget.
 *
 * UI only for now: a baby-pink square with the title top-left and a stock-market
 * illustration (candlesticks, trend arrow, "?" bubble) bleeding off the bottom-right.
 * There is no quiz behind it yet; pass `onPress` once there is.
 *
 * It is a true square (aspectRatio 1) and takes its width from `style`, so the
 * parent decides the size (default: just under half the row, i.e. a two-up grid).
 *
 * Props:
 *   title    string    — default "Daily Quiz"
 *   onPress  function  — optional; makes the card tappable
 *   style    object    — merged onto the card (e.g. { width: 160 })
 */
export default function DailyQuizCard({ title = "Daily Quiz", onPress, style }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? { onPress, activeOpacity: 0.85, accessibilityRole: "button", accessibilityLabel: title }
    : {};

  return (
    <Wrapper {...wrapperProps} style={[styles.shadow, style]}>
      <LinearGradient
        colors={[PINK_LIGHT, PINK_DEEP]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>

        <StockQuizIllustration
          width="82%"
          height="62%"
          style={styles.art}
        />
      </LinearGradient>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  // The shadow lives on an outer view: the gradient clips its children
  // (overflow hidden), which would also clip its own shadow on iOS.
  shadow: {
    width: "48%",
    aspectRatio: 1,
    borderRadius: 24,
    backgroundColor: PINK_DEEP,
    ...Shadows.card,
  },
  card: {
    flex: 1,
    borderRadius: 24,
    padding: moderateScale(16),
    overflow: "hidden",
  },
  title: {
    color: Colors.text,
    fontSize: fontScale(22),
    lineHeight: fontScale(27),
    fontWeight: "800",
    letterSpacing: -0.5,
    // keep the words clear of the illustration
    maxWidth: "85%",
  },
  art: {
    position: "absolute",
    right: -moderateScale(6),
    bottom: moderateScale(4),
  },
});
