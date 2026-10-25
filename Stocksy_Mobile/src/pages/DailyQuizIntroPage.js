import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Ellipse, G, Path, Polygon } from "react-native-svg";

import { Colors, moderateScale } from "../theme";

// The native animation driver doesn't exist on web; asking for it there only logs warnings.
const NATIVE = Platform.OS !== "web";

// App-theme blue (Colors.primary -> Colors.primaryDark), top-left to bottom-right.
const BLUE_LIGHT = Colors.primary;
const BLUE_DEEP = Colors.primaryDark;

// Doodle palette — pastel strokes that pop on the blue.
const PINK = "#F9A8D4";
const MINT = "#86EFAC";
const INK = "#0F172A";

/** Honour the device's "reduce motion" setting: everything then stays still. */
function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => alive && setReduce(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v) => setReduce(!!v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}

/** A 0 <-> 1 value that eases back and forth forever, after an optional start delay. */
function useLoop(duration, delay, paused) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (paused) {
      v.setValue(0.5);
      return undefined;
    }
    const ease = Easing.inOut(Easing.sin);
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration, easing: ease, useNativeDriver: NATIVE }),
          Animated.timing(v, { toValue: 0, duration, easing: ease, useNativeDriver: NATIVE }),
        ]),
      ),
    ]);
    anim.start();
    return () => anim.stop();
  }, [v, duration, delay, paused]);
  return v;
}

/**
 * Wraps a graphic so it drifts up/down, sways a few degrees and "breathes" (scales),
 * each on its own period so the doodles never move in lockstep.
 */
function Floaty({ children, style, floatBy = 8, sway = 4, tilt = 0, floatMs = 2600, breatheMs = 1900, delay = 0, paused }) {
  const float = useLoop(floatMs, delay, paused);
  const breathe = useLoop(breatheMs, delay + 300, paused);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [floatBy, -floatBy] });
  const rotate = float.interpolate({
    inputRange: [0, 1],
    outputRange: [`${tilt - sway}deg`, `${tilt + sway}deg`],
  });
  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.08] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[style, { transform: [{ translateY }, { rotate }, { scale }] }]}
    >
      {children}
    </Animated.View>
  );
}

/* ----------------------------- SVG doodles ----------------------------- */

/** Outlined eight-petal flower with a small centre. */
function FlowerSvg({ size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <G fill="none" stroke={PINK} strokeWidth={4} strokeLinejoin="round">
        {Array.from({ length: 8 }).map((_, i) => (
          <Ellipse key={i} cx={50} cy={22} rx={11} ry={19} transform={`rotate(${i * 45} 50 50)`} />
        ))}
      </G>
      <Circle cx={50} cy={50} r={7} fill="none" stroke={PINK} strokeWidth={4} />
    </Svg>
  );
}

/** Spiky starburst, filled mint green. */
function BurstSvg({ size }) {
  const points = useMemo(() => {
    const spikes = 12;
    const out = [];
    for (let i = 0; i < spikes * 2; i += 1) {
      const r = i % 2 === 0 ? 48 : 26;
      const a = (Math.PI * i) / spikes - Math.PI / 2;
      out.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
    }
    return out.join(" ");
  }, []);

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Polygon points={points} fill={MINT} stroke={MINT} strokeWidth={3} strokeLinejoin="round" />
      <Circle cx={50} cy={50} r={9} fill={BLUE_DEEP} opacity={0.35} />
    </Svg>
  );
}

/** Loop-the-loop squiggle with an arrow head, drawn in ink. */
function SquiggleSvg({ size }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <G fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M12 70 C 30 96, 66 92, 62 62 C 59 40, 30 44, 36 66 C 41 84, 74 74, 88 44" />
        <Path d="M74 42 L 90 40 L 88 56" />
      </G>
    </Svg>
  );
}

/* ------------------------------ Text pieces ----------------------------- */

/** One row of copy that fades + rises into place, staggered by `index`. */
function RiseRow({ progress, index, children, style }) {
  // Each row owns a slice of the shared 0 -> 1 progress value.
  const start = Math.min(index * 0.11, 0.7);
  const end = Math.min(start + 0.3, 1);
  const opacity = progress.interpolate({ inputRange: [start, end], outputRange: [0, 1], extrapolate: "clamp" });
  const translateY = progress.interpolate({
    inputRange: [start, end],
    outputRange: [moderateScale(26), 0],
    extrapolate: "clamp",
  });
  return <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

/**
 * "Win." — white text on blue, with a white box that sweeps in from the left,
 * holds, then sweeps out to the right and repeats. The dark text is revealed only
 * where the box is (mask moves one way, its content moves the opposite way).
 */
function WinHighlight({ text, textStyle, paused }) {
  const [w, setW] = useState(0);
  // -1 = box fully off to the left, 0 = covering the word, 1 = fully off to the right.
  const p = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    if (paused) {
      p.setValue(0);
      return undefined;
    }
    p.setValue(-1);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(900),
        Animated.timing(p, { toValue: 0, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
        Animated.delay(2600),
        Animated.timing(p, { toValue: 1, duration: 700, easing: Easing.in(Easing.cubic), useNativeDriver: NATIVE }),
        Animated.delay(500),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [p, paused]);

  const maskX = p.interpolate({ inputRange: [-1, 1], outputRange: [-w, w] });
  const innerX = p.interpolate({ inputRange: [-1, 1], outputRange: [w, -w] });

  return (
    <View
      style={styles.winWrap}
      onLayout={(e) => setW(Math.ceil(e.nativeEvent.layout.width))}
    >
      {/* base layer: white text, also sizes the wrapper */}
      <Text style={[textStyle, styles.winPad]} numberOfLines={1}>
        {text}
      </Text>

      {w > 0 && (
        <Animated.View style={[styles.winMask, { transform: [{ translateX: maskX }] }]}>
          <Animated.View style={[styles.winInner, { transform: [{ translateX: innerX }] }]}>
            <Text style={[textStyle, styles.winPad, { color: BLUE_DEEP }]} numberOfLines={1}>
              {text}
            </Text>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

/** A small tilted tag, like the floating labels in the reference. */
function Pill({ label, bg, fg, fs }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg, paddingHorizontal: fs * 0.55, paddingVertical: fs * 0.2 }]}>
      <Text style={{ color: fg, fontSize: fs, fontWeight: "700", letterSpacing: 0.2 }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * DailyQuizIntroPage — full-screen "Daily Quiz" intro, opened from the Daily Quiz card.
 *
 * Theme-blue screen with big white copy that rises in row by row:
 *   "Learn, grow, [Win.]  Take the first step with us"
 * where a white box keeps sweeping left -> right behind "Win.". A flower, a
 * starburst and a squiggle (all SVG) float and breathe around it, together with
 * a few small tags. Animations pause when the device's "reduce motion" is on.
 */
export default function DailyQuizIntroPage({ navigation }) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  // Type scale follows the screen width, capped for tablets / web.
  const fs = Math.min(width * 0.15, 68);
  const textStyle = {
    color: Colors.white,
    fontSize: fs,
    lineHeight: fs * 1.08,
    fontWeight: "800",
    letterSpacing: -fs * 0.03,
  };
  const pillFs = Math.max(11, fs * 0.2);
  const flowerSize = Math.min(width * 0.42, 190);
  const burstSize = fs * 1.35;
  const squiggleSize = fs * 1.5;

  // Entrance: one value drives all the staggered rows.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      enter.setValue(1);
      return undefined;
    }
    enter.setValue(0);
    const anim = Animated.timing(enter, {
      toValue: 1,
      duration: 1500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    anim.start();
    return () => anim.stop();
  }, [enter, reduceMotion]);

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("MainTabs");
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={BLUE_LIGHT} />
      <LinearGradient
        colors={[BLUE_LIGHT, BLUE_DEEP]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.safe}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.closeBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={moderateScale(22)} color={Colors.white} />
        </TouchableOpacity>

        {/* big flower, top-right, behind the copy */}
        <Floaty
          style={[styles.flower, { top: moderateScale(70), right: -flowerSize * 0.1 }]}
          floatBy={9}
          sway={6}
          tilt={-8}
          floatMs={3200}
          breatheMs={2400}
          paused={reduceMotion}
        >
          <FlowerSvg size={flowerSize} />
        </Floaty>

        <View
          style={styles.copy}
          accessible
          accessibilityRole="header"
          accessibilityLabel="Learn, grow, win. Take the first step with us."
        >
          <RiseRow progress={enter} index={0} style={styles.row}>
            <Text style={textStyle}>Learn,</Text>
            <Floaty
              style={[styles.pillSlot, { right: width * 0.1, top: fs * 0.05 }]}
              floatBy={4}
              sway={3}
              tilt={-12}
              floatMs={2200}
              breatheMs={1800}
              delay={200}
              paused={reduceMotion}
            >
              <Pill label="Stocks" bg={MINT} fg={INK} fs={pillFs} />
            </Floaty>
          </RiseRow>

          <RiseRow progress={enter} index={1} style={styles.row}>
            <Text style={textStyle}>grow,</Text>
          </RiseRow>

          <RiseRow progress={enter} index={2} style={styles.row}>
            <WinHighlight text="Win." textStyle={textStyle} paused={reduceMotion} />
            <Floaty
              style={[styles.pillSlot, { right: width * 0.08, top: fs * 0.55 }]}
              floatBy={4}
              sway={3}
              tilt={8}
              floatMs={2500}
              breatheMs={2100}
              delay={500}
              paused={reduceMotion}
            >
              <Pill label="Quiz" bg={Colors.primaryAccent} fg={Colors.white} fs={pillFs} />
            </Floaty>
          </RiseRow>

          <RiseRow progress={enter} index={3} style={[styles.row, { marginTop: fs * 0.25 }]}>
            <Floaty
              style={[styles.burstSlot, { top: -fs * 0.1 }]}
              floatBy={7}
              sway={9}
              tilt={6}
              floatMs={2400}
              breatheMs={1700}
              delay={400}
              paused={reduceMotion}
            >
              <BurstSvg size={burstSize} />
            </Floaty>
            <Text style={[textStyle, { marginLeft: burstSize * 1.15 }]}>Take</Text>
          </RiseRow>

          <RiseRow progress={enter} index={4} style={styles.row}>
            <Text style={textStyle}>the first</Text>
            <Floaty
              style={[styles.pillSlot, { right: width * 0.02, top: fs * 0.3 }]}
              floatBy={4}
              sway={3}
              tilt={-6}
              floatMs={2300}
              breatheMs={1900}
              delay={700}
              paused={reduceMotion}
            >
              <Pill label="Markets" bg={INK} fg={Colors.white} fs={pillFs} />
            </Floaty>
          </RiseRow>

          <RiseRow progress={enter} index={5} style={styles.row}>
            <Text style={textStyle}>step</Text>
            <Floaty
              style={[styles.pillSlot, { right: width * 0.16, top: fs * 0.6 }]}
              floatBy={4}
              sway={3}
              tilt={10}
              floatMs={2700}
              breatheMs={2000}
              delay={900}
              paused={reduceMotion}
            >
              <Pill label="Streaks" bg={MINT} fg={INK} fs={pillFs} />
            </Floaty>
          </RiseRow>

          <RiseRow progress={enter} index={6} style={styles.row}>
            <Text style={textStyle}>with us</Text>
            <Floaty
              style={[styles.pillSlot, { right: width * 0.02, top: fs * 0.2 }]}
              floatBy={6}
              sway={5}
              tilt={0}
              floatMs={2800}
              breatheMs={2000}
              delay={800}
              paused={reduceMotion}
            >
              <SquiggleSvg size={squiggleSize} />
            </Floaty>
          </RiseRow>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BLUE_DEEP },
  safe: { flex: 1 },

  closeBtn: {
    marginLeft: moderateScale(16),
    marginTop: moderateScale(8),
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: moderateScale(19),
    backgroundColor: "rgba(255,255,255,0.18)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 5,
  },

  copy: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: moderateScale(24),
    paddingBottom: moderateScale(24),
  },
  row: { position: "relative" },

  // "Win." highlight
  winWrap: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: 4,
  },
  winPad: { paddingHorizontal: moderateScale(8) },
  winMask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.white,
    overflow: "hidden",
  },
  winInner: { ...StyleSheet.absoluteFillObject },

  // doodle placement
  flower: { position: "absolute" },
  pillSlot: { position: "absolute" },
  burstSlot: { position: "absolute", left: 0 },
  pill: { borderRadius: 99 },
});
