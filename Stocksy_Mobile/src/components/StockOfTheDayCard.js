import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import StockOfTheDayIllustration from "./StockOfTheDayIllustration";
import { Colors, Shadows, fontScale, moderateScale } from "../theme";

// Baby yellow: soft pale lemon-cream to a warm pastel honey-amber.
const YELLOW_LIGHT = "#FEF9C3";
const YELLOW_DEEP = "#FDE68A";

/**
 * StockOfTheDayCard — the square "Stock of the Day" widget.
 *
 * Designed to sit beside DailyQuizCard in the two-up widget row on DailyChallengePage.
 * Features a warm baby-yellow gradient background, bold title with optional ticker pill,
 * and a high-craft vector illustration of breakout candlesticks with a golden star medal.
 *
 * Takes its width from `style` (default: 48% width with aspectRatio 1 for a two-up grid).
 *
 * Props:
 *   title     string    — default "Stock of\nthe Day"
 *   subtitle  string    — optional ticker / tag (e.g. "TATAMOTORS")
 *   onPress   function  — optional; makes the card tappable
 *   style     object    — merged onto the outer card container
 */
export default function StockOfTheDayCard({
  title = "Stock of\nthe Day",
  subtitle = "TATAMOTORS",
  onPress,
  style,
}) {
  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? {
      onPress,
      activeOpacity: 0.85,
      accessibilityRole: "button",
      accessibilityLabel: subtitle ? `${title}: ${subtitle}` : title,
    }
    : {};

  return (
    <Wrapper {...wrapperProps} style={[styles.shadow, style]}>
      <LinearGradient
        colors={[YELLOW_LIGHT, YELLOW_DEEP]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>

        <StockOfTheDayIllustration
          width="82%"
          height="62%"
          style={styles.art}
        />
      </LinearGradient>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  // Outer view holds the shadow so that gradient's overflow: "hidden" does not clip it
  shadow: {
    width: "48%",
    aspectRatio: 1,
    borderRadius: 24,
    backgroundColor: YELLOW_DEEP,
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
    maxWidth: "85%",
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(146, 64, 14, 0.12)",
    borderRadius: moderateScale(6),
    paddingHorizontal: moderateScale(6),
    paddingVertical: moderateScale(2),
    marginTop: moderateScale(4),
    maxWidth: "80%",
  },
  badgeText: {
    color: "#92400E",
    fontSize: fontScale(10.5),
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  art: {
    position: "absolute",
    right: -moderateScale(6),
    bottom: moderateScale(4),
  },
});
