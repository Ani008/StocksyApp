import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Ellipse, G, Path, Polygon } from "react-native-svg";

import { Colors, Shadows, fontScale, moderateScale } from "../theme";

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
function Floaty({ children, style, floatBy = 5, sway = 4, tilt = 0, floatMs = 2600, breatheMs = 1900, delay = 0, paused }) {
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
      <G fill="none" stroke={PINK} strokeWidth={4.5} strokeLinejoin="round">
        {Array.from({ length: 8 }).map((_, i) => (
          <Ellipse key={i} cx={50} cy={22} rx={11} ry={19} transform={`rotate(${i * 45} 50 50)`} />
        ))}
      </G>
      <Circle cx={50} cy={50} r={7} fill="none" stroke={PINK} strokeWidth={4.5} />
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
      <G fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M12 70 C 30 96, 66 92, 62 62 C 59 40, 30 44, 36 66 C 41 84, 74 74, 88 44" />
        <Path d="M74 42 L 90 40 L 88 56" />
      </G>
    </Svg>
  );
}

/* ------------------------------ Text pieces ----------------------------- */

/** A line of copy that fades + rises into place, staggered by `index`. */
function RiseLine({ progress, index, children }) {
  // Each line owns a slice of the shared 0 -> 1 progress value.
  const start = Math.min(index * 0.16, 0.7);
  const end = Math.min(start + 0.32, 1);
  const opacity = progress.interpolate({ inputRange: [start, end], outputRange: [0, 1], extrapolate: "clamp" });
  const translateY = progress.interpolate({
    inputRange: [start, end],
    outputRange: [moderateScale(14), 0],
    extrapolate: "clamp",
  });
  return <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>;
}

/**
 * "Win." — white text on blue, with a white box that sweeps in from the left,
 * holds, then sweeps out to the right and repeats. The dark text is revealed only
 * where the box is (mask moves one way, its content moves the opposite way).
 */
function WinHighlight({ text, paused }) {
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
        Animated.delay(650),
        Animated.timing(p, { toValue: 0, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
        Animated.delay(2400),
        Animated.timing(p, { toValue: 1, duration: 650, easing: Easing.in(Easing.cubic), useNativeDriver: NATIVE }),
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
      <Text style={[styles.line, styles.winText]} numberOfLines={1}>
        {text}
      </Text>

      {w > 0 && (
        <Animated.View style={[styles.winMask, { transform: [{ translateX: maskX }] }]}>
          <Animated.View style={[styles.winInner, { transform: [{ translateX: innerX }] }]}>
            <Text style={[styles.line, styles.winTextDark]} numberOfLines={1}>
              {text}
            </Text>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

/** A small tilted tag, like the floating labels in the reference. */
function Pill({ label, bg, fg }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * DailyQuizCard — the square "Daily Quiz" widget.
 *
 * Theme-blue square with white copy that rises in line by line:
 *   "Learn, grow, [Win.]  Take the first step with us"
 * where a white box keeps sweeping left -> right behind "Win.". A flower, a
 * starburst and a squiggle (all SVG) float and breathe around it, together with
 * two small tags. Animations pause when the device's "reduce motion" is on.
 *
 * It is a true square (aspectRatio 1) and takes its width from `style`, so the
 * parent decides the size (default: just under half the row, i.e. a two-up grid).
 *
 * Props:
 *   onPress  function  — optional; makes the card tappable
 *   tags     [string, string] — the two floating labels (default ["Stocks", "Quiz"])
 *   style    object    — merged onto the card (e.g. { width: 160 })
 */
export default function DailyQuizCard({ onPress, tags = ["Stocks", "Quiz"], style }) {
  const reduceMotion = useReduceMotion();

  // Entrance: one value drives all the staggered text lines.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) {
      enter.setValue(1);
      return undefined;
    }
    enter.setValue(0);
    const anim = Animated.timing(enter, {
      toValue: 1,
      duration: 1100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    anim.start();
    return () => anim.stop();
  }, [enter, reduceMotion]);

  const label = "Daily Quiz. Learn, grow, win. Take the first step with us.";
  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? { onPress, activeOpacity: 0.9, accessibilityRole: "button", accessibilityLabel: label }
    : { accessible: true, accessibilityLabel: label };

  return (
    <Wrapper {...wrapperProps} style={[styles.shadow, style]}>
      <LinearGradient
        colors={[BLUE_LIGHT, BLUE_DEEP]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {/* floating doodles (behind the copy) */}
        <Floaty style={styles.flower} floatBy={4} sway={6} tilt={-8} floatMs={3000} breatheMs={2200} paused={reduceMotion}>
          <FlowerSvg size={moderateScale(62)} />
        </Floaty>

        <Floaty style={styles.burst} floatBy={5} sway={8} tilt={6} floatMs={2400} breatheMs={1700} delay={400} paused={reduceMotion}>
          <BurstSvg size={moderateScale(46)} />
        </Floaty>

        <Floaty style={styles.squiggle} floatBy={4} sway={5} tilt={0} floatMs={2800} breatheMs={2000} delay={800} paused={reduceMotion}>
          <SquiggleSvg size={moderateScale(44)} />
        </Floaty>

        <Floaty style={styles.pillA} floatBy={3} sway={3} tilt={-12} floatMs={2200} breatheMs={1800} delay={200} paused={reduceMotion}>
          <Pill label={tags[0]} bg={MINT} fg={INK} />
        </Floaty>

        <Floaty style={styles.pillB} floatBy={3} sway={3} tilt={9} floatMs={2500} breatheMs={2100} delay={600} paused={reduceMotion}>
          <Pill label={tags[1]} bg={INK} fg={Colors.white} />
        </Floaty>

        {/* copy */}
        <View style={styles.copy} pointerEvents="none">
          <RiseLine progress={enter} index={0}>
            <Text style={styles.line} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              Learn, grow,
            </Text>
          </RiseLine>

          <RiseLine progress={enter} index={1}>
            <WinHighlight text="Win." paused={reduceMotion} />
          </RiseLine>

          <RiseLine progress={enter} index={2}>
            <Text style={styles.line} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              Take the first
            </Text>
          </RiseLine>

          <RiseLine progress={enter} index={3}>
            <Text style={styles.line} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              step with us
            </Text>
          </RiseLine>
        </View>
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
    backgroundColor: BLUE_DEEP,
    ...Shadows.card,
  },
  card: {
    flex: 1,
    borderRadius: 24,
    overflow: "hidden",
  },

  copy: {
    flex: 1,
    paddingTop: moderateScale(14),
    paddingLeft: moderateScale(14),
    paddingRight: moderateScale(10),
  },
  line: {
    color: Colors.white,
    fontSize: fontScale(18),
    lineHeight: fontScale(22),
    fontWeight: "800",
    letterSpacing: -0.5,
  },

  // "Win." highlight
  winWrap: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: 3,
    marginVertical: moderateScale(1),
  },
  winText: {
    paddingHorizontal: moderateScale(5),
  },
  winMask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.white,
    overflow: "hidden",
  },
  winInner: {
    ...StyleSheet.absoluteFillObject,
  },
  winTextDark: {
    color: BLUE_DEEP,
    paddingHorizontal: moderateScale(5),
  },

  // doodle placement (all relative to the square)
  flower: { position: "absolute", top: -moderateScale(12), right: -moderateScale(14) },
  burst: { position: "absolute", left: moderateScale(6), bottom: moderateScale(6) },
  squiggle: { position: "absolute", right: moderateScale(8), bottom: moderateScale(6) },
  pillA: { position: "absolute", top: moderateScale(40), right: moderateScale(8) },
  pillB: { position: "absolute", bottom: moderateScale(34), right: moderateScale(40) },

  pill: {
    borderRadius: 99,
    paddingHorizontal: moderateScale(7),
    paddingVertical: moderateScale(2.5),
  },
  pillText: {
    fontSize: fontScale(8.5),
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
