import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import ChallengeIllustration from "./ChallengeIllustration";
import SlideButton from "./SlideButton";
import { Colors, Shadows, fontScale, moderateScale } from "../theme";

// Baby lavender: pairs with the baby-pink quiz card and baby-yellow stock card.
const LAVENDER_LIGHT = "#EDE9FE";
const LAVENDER_DEEP = "#DDD6FE";
const INK = "#1E1B4B"; // deep indigo for the button track

/**
 * ChallengeFriendCard — the wide "Games" card under the two square widgets.
 *
 * A small "Games" eyebrow, the pitch, and a slide button. UI only for now:
 * there is no challenge flow behind it yet, so `onChallenge` is optional and
 * nothing happens when the slide completes unless you pass one.
 *
 * Props:
 *   eyebrow      string    — default "Games"
 *   title        string    — default "Challenge your friend for exciting trading game"
 *   buttonLabel  string    — default "Slide to challenge"
 *   onChallenge  function  — called when the slide completes (optional)
 *   style        object    — merged onto the outer card container
 */
export default function ChallengeFriendCard({
  eyebrow = "Games",
  title = "Challenge your friend for exciting trading game",
  buttonLabel = "Slide to challenge",
  onChallenge,
  style,
}) {
  return (
    <View style={[styles.shadow, style]}>
      <LinearGradient
        colors={[LAVENDER_LIGHT, LAVENDER_DEEP]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {/* top row: eyebrow + corner badge */}
        <View style={styles.topRow}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <View style={styles.badge}>
            <Ionicons name="game-controller" size={moderateScale(16)} color={Colors.white} />
          </View>
        </View>

        {/* pitch: kept to the left so the illustration has room */}
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>

        <ChallengeIllustration width={moderateScale(118)} height={moderateScale(118)} style={styles.art} />

        {/* the reusable slide button, as a compact pill under the text */}
        <SlideButton
          label={buttonLabel}
          onComplete={onChallenge}
          trackColor={INK}
          iconColor={INK}
          style={styles.button}
        />
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  // The shadow lives on an outer view: the gradient clips its children
  // (overflow hidden), which would also clip its own shadow on iOS.
  shadow: {
    borderRadius: 24,
    backgroundColor: LAVENDER_DEEP,
    ...Shadows.card,
  },
  card: {
    borderRadius: 24,
    padding: moderateScale(20),
    overflow: "hidden",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: Colors.textSecondary,
    fontSize: fontScale(14),
    fontWeight: "600",
  },
  badge: {
    width: moderateScale(32),
    height: moderateScale(32),
    borderRadius: moderateScale(10),
    backgroundColor: INK,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: Colors.text,
    fontSize: fontScale(22),
    lineHeight: fontScale(28),
    fontWeight: "800",
    letterSpacing: -0.4,
    marginTop: moderateScale(10),
    // keep the words clear of the illustration
    maxWidth: "62%",
  },
  art: {
    position: "absolute",
    right: moderateScale(8),
    top: moderateScale(52),
  },
  button: {
    marginTop: moderateScale(22),
    // compact pill, like the reference; the slide still has room to travel
    width: "66%",
  },
});
