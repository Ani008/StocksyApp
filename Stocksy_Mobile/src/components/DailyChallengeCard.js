import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
// import { Ionicons } from "@expo/vector-icons"; // avatars (parked, see below)
import FloatingCandles from "./FloatingCandles";

import { Colors, fontScale, moderateScale } from "../theme";

// ── Avatars: PARKED until the avatar library exists ──────────────────────────
// Everything for the avatar row is commented out, not deleted. To bring it
// back: uncomment this block, the Ionicons import, the `avatars` / `extra`
// props, the JSX row near the bottom, and the avatar styles at the end.
//
// const AVATAR = moderateScale(40);
// const AVATAR_OVERLAP = moderateScale(12);
//
// // Default faces. There are no photos yet, so each is a coloured circle from the
// // app's palette; swap in real pictures from the avatar library later.
// const DEFAULT_AVATARS = [
//   { bg: Colors.primary, icon: "person" },
//   { bg: Colors.gain, icon: "person" },
//   { bg: Colors.warning, icon: "person" },
// ];

// "08:00 AM" must wrap as one unit, never "08:00" / "AM" on two lines.
const keepTimeTogether = (text) => String(text).replace(/(\d{1,2}:\d{2}) (AM|PM)/gi, "$1\u00A0$2");

/**
 * DailyChallengeCard — the static "Daily Challenge" banner.
 *
 * Nothing is planned for it yet, so it is display-only: a title, a line of text
 * and a pair of floating, breathing candlesticks. (The avatar row is parked
 * until the avatar library exists.)
 * When challenges become real, this is the card that will carry them.
 *
 * Props:
 *   title     string  — default "Daily Challenge\n& Games" (\n starts a new line)
 *   subtitle  string  — default "Do your plan before 08:00 AM"
 */
export default function DailyChallengeCard({
  title = "Daily Challenge\n& Games",
  subtitle = "Do your plan before 08:00 AM",
  // avatars = DEFAULT_AVATARS, // [{ bg, icon }] faces in the avatar row (parked)
  // extra = 4, // the "+N" bubble after the avatars, 0 hides it (parked)
  style,
}) {
  // A "\n" in the title starts a new line.
  const lines = String(title).split("\n");

  return (
    <LinearGradient
      colors={[Colors.primaryLight, "#BFDBFE"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, style]}
    >
      {/* floating red + green candlesticks, vertically centred on the right */}
      <FloatingCandles style={styles.candles} />

      <View style={styles.textBlock}>
        <Text style={styles.title} accessibilityRole="header">
          {lines.join("\n")}
        </Text>
        <Text style={styles.subtitle}>{keepTimeTogether(subtitle)}</Text>
      </View>

      {/* Avatar row: parked until the avatar library exists (uncomment to restore).
      <View style={styles.people} accessibilityLabel={`${avatars.length + extra} people`}>
        {avatars.map((a, i) => (
          <View
            key={i}
            style={[styles.avatar, { backgroundColor: a.bg, marginLeft: i === 0 ? 0 : -AVATAR_OVERLAP, zIndex: avatars.length - i }]}
          >
            <Ionicons name={a.icon || "person"} size={moderateScale(20)} color={Colors.white} />
          </View>
        ))}
        {extra > 0 ? (
          <View style={[styles.avatar, styles.extra, { marginLeft: -AVATAR_OVERLAP }]}>
            <Text style={styles.extraText}>+{extra}</Text>
          </View>
        ) : null}
      </View>
      */}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: moderateScale(22),
    overflow: "hidden",
    justifyContent: "space-between",
    minHeight: moderateScale(240),
  },
  candles: {
    position: "absolute",
    right: moderateScale(18),
    top: moderateScale(8),
  },
  textBlock: {
    // keep the words clear of the candles
    maxWidth: "58%",
  },
  title: {
    color: Colors.text,
    fontSize: fontScale(27),
    lineHeight: fontScale(32),
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  subtitle: {
    color: Colors.text,
    fontSize: fontScale(14),
    lineHeight: fontScale(19),
    fontWeight: "500",
    marginTop: moderateScale(10),
  },
  // Avatar row styles: parked with the row above.
  // people: {
  //   flexDirection: "row",
  //   alignItems: "center",
  //   marginTop: moderateScale(18),
  // },
  // avatar: {
  //   width: AVATAR,
  //   height: AVATAR,
  //   borderRadius: AVATAR / 2,
  //   alignItems: "center",
  //   justifyContent: "center",
  //   borderWidth: 2.5,
  //   borderColor: Colors.primaryLight,
  // },
  // extra: { backgroundColor: Colors.chartBg, zIndex: 0 },
  // extraText: { color: Colors.white, fontSize: fontScale(13), fontWeight: "700" },
});
