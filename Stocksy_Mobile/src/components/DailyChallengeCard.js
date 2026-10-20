import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Defs, G, LinearGradient as SvgGradient, Path, Stop } from "react-native-svg";

import { Colors, fontScale, moderateScale } from "../theme";

// Warm accent for the flower. It is the app's own amber (Colors.warning) in
// lighter and darker steps, so it pops against the blue card the way the
// yellow flower does against the purple card in the design.
const PETAL_LIGHT = "#FDE68A";
const PETAL_MID = "#FBBF24";
const PETAL_DEEP = Colors.warning; // "#F59E0B"
const PETAL_EDGE = "#B45309";

const AVATAR = moderateScale(40);
const AVATAR_OVERLAP = moderateScale(12);

// Default faces. There are no photos yet, so each is a coloured circle from the
// app's palette; pass `avatars` (image sources) to show real pictures later.
const DEFAULT_AVATARS = [
  { bg: Colors.primary, icon: "person" },
  { bg: Colors.gain, icon: "person" },
  { bg: Colors.warning, icon: "person" },
];

// "08:00 AM" must wrap as one unit, never "08:00" / "AM" on two lines.
const keepTimeTogether = (text) => String(text).replace(/(\d{1,2}:\d{2}) (AM|PM)/gi, "$1\u00A0$2");

// SVG ids are global in the browser, so each flower needs its own.
let flowerCount = 0;

// One teardrop petal pointing up from the centre of a 100x100 box.
const PETAL = "M50 55 C 33 48, 27 24, 37 11 C 43 3, 57 3, 63 11 C 73 24, 67 48, 50 55 Z";
const PETAL_SHINE = "M42 40 C 37 31, 38 20, 44 14 C 48 11, 52 12, 52 17 C 52 26, 49 35, 42 40 Z";

/** A chunky six-petal 3D flower, drawn as vector shapes (no image file needed). */
function Flower({ size }) {
  const id = React.useRef(`flower${++flowerCount}`).current;
  const petals = [0, 60, 120, 180, 240, 300];

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <SvgGradient id={`${id}-petal`} x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor={PETAL_LIGHT} />
          <Stop offset="0.55" stopColor={PETAL_MID} />
          <Stop offset="1" stopColor={PETAL_DEEP} />
        </SvgGradient>
        <SvgGradient id={`${id}-core`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={PETAL_LIGHT} />
          <Stop offset="1" stopColor={PETAL_DEEP} />
        </SvgGradient>
      </Defs>

      {petals.map((deg) => (
        <G key={deg} rotation={deg} origin="50, 50">
          <Path d={PETAL} fill={`url(#${id}-petal)`} stroke={PETAL_EDGE} strokeOpacity={0.28} strokeWidth={0.8} />
          <Path d={PETAL_SHINE} fill="#FFFFFF" opacity={0.38} />
        </G>
      ))}

      <Circle cx="50" cy="50" r="12" fill={`url(#${id}-core)`} stroke={PETAL_EDGE} strokeOpacity={0.3} strokeWidth={0.8} />
      <Circle cx="46.5" cy="46" r="3.6" fill="#FFFFFF" opacity={0.55} />
    </Svg>
  );
}

/**
 * DailyChallengeCard — the static "Daily Challenge" banner.
 *
 * Nothing is planned for it yet, so it is display-only: a title, a line of text,
 * a row of avatars and the flower. When challenges become real, this is the
 * card that will carry them.
 *
 * Props:
 *   title     string  — default "Daily Challenge"
 *   subtitle  string  — default "Do your plan before 08:00 AM"
 *   avatars   array   — [{ bg, icon }] placeholder faces (default: three)
 *   extra     number  — the "+N" bubble after the avatars (default 4, 0 hides it)
 */
export default function DailyChallengeCard({
  title = "Daily Challenge",
  subtitle = "Do your plan before 08:00 AM",
  avatars = DEFAULT_AVATARS,
  extra = 4,
  style,
}) {
  // "Daily Challenge" is set on two lines, like the design.
  const [first, ...rest] = String(title).split(" ");
  const lines = rest.length ? [first, rest.join(" ")] : [first];

  return (
    <LinearGradient
      colors={[Colors.primaryLight, "#BFDBFE"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, style]}
    >
      {/* flower: large, tilted, and cropped by the card's right edge */}
      <View pointerEvents="none" style={styles.flower}>
        <Flower size={moderateScale(190)} />
      </View>

      <View style={styles.textBlock}>
        <Text style={styles.title} accessibilityRole="header">
          {lines.join("\n")}
        </Text>
        <Text style={styles.subtitle}>{keepTimeTogether(subtitle)}</Text>
      </View>

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
  flower: {
    position: "absolute",
    right: -moderateScale(46),
    top: -moderateScale(8),
    transform: [{ rotate: "14deg" }],
  },
  textBlock: {
    // keep the words clear of the flower
    maxWidth: "62%",
  },
  title: {
    color: Colors.text,
    fontSize: fontScale(32),
    lineHeight: fontScale(37),
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
  people: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: moderateScale(18),
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: Colors.primaryLight,
  },
  extra: { backgroundColor: Colors.chartBg, zIndex: 0 },
  extraText: { color: Colors.white, fontSize: fontScale(13), fontWeight: "700" },
});
