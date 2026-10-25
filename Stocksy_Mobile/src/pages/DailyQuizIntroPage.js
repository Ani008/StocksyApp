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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Ellipse, G, Path, Polygon } from "react-native-svg";

import { QUIZ_COVER_COLOR } from "../components/RevealCover";
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

// Loader timing.
const LOAD_MS = 2000; // how long the "getting things ready" loader runs
const EXPAND_MS = 700; // how long the dot takes to flood the screen

// Loader geometry.
const RING = 48;
const RING_STROKE = 3;
const RING_R = (RING - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;
const DOT = 14;
const TEXT_LINE = 20;
const TEXT_GAP = 14;
const LOADER_BOTTOM = 28; // distance from the bottom safe edge to the message

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

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
 * holds, then sweeps out to the right and repeats.
 *
 * Built so there is only ever ONE visible "Win.": a white-text base layer, and a
 * box (left edge L, right edge R, both animated) that clips a dark copy of the
 * word. The dark copy is pinned to the wrapper (left = -L, fixed width) so it
 * never drifts, and anything outside the box is cut off by overflow: hidden.
 */
function WinHighlight({ text, textStyle, paused }) {
  const [w, setW] = useState(0);
  const L = useRef(new Animated.Value(0)).current; // box left edge
  const R = useRef(new Animated.Value(0)).current; // box right edge

  useEffect(() => {
    if (!w) return undefined;
    if (paused) {
      L.setValue(0);
      R.setValue(w);
      return undefined;
    }
    L.setValue(0);
    R.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(900),
        // sweep in: right edge runs left -> right
        Animated.timing(R, { toValue: w, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.delay(2600),
        // sweep out: left edge catches up, left -> right
        Animated.timing(L, { toValue: w, duration: 700, easing: Easing.in(Easing.cubic), useNativeDriver: false }),
        Animated.delay(500),
        // reset for the next pass
        Animated.parallel([
          Animated.timing(L, { toValue: 0, duration: 0, useNativeDriver: false }),
          Animated.timing(R, { toValue: 0, duration: 0, useNativeDriver: false }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [L, R, w, paused]);

  const boxWidth = useMemo(() => Animated.subtract(R, L), [L, R]);
  const innerLeft = useMemo(() => Animated.multiply(L, -1), [L]);

  return (
    <View style={styles.winWrap} onLayout={(e) => setW(Math.ceil(e.nativeEvent.layout.width))}>
      {/* base layer: white text, also sizes the wrapper */}
      <Text style={[textStyle, styles.winPad]} numberOfLines={1}>
        {text}
      </Text>

      {w > 0 && (
        <Animated.View style={[styles.winBox, { left: L, width: boxWidth }]}>
          <Animated.View style={[styles.winInner, { left: innerLeft, width: w }]}>
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

/** "..." that cycles 0-3 dots; sits in a fixed-width box so the message never jitters. */
function Ellipsis({ style, paused }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    if (paused) return undefined;
    const id = setInterval(() => setN((c) => (c + 1) % 4), 380);
    return () => clearInterval(id);
  }, [paused]);
  return <Text style={[style, styles.ellipsis]}>{".".repeat(n)}</Text>;
}

/**
 * DailyQuizIntroPage — full-screen "Daily Quiz" intro, opened from the Daily Quiz card.
 *
 * Theme-blue screen with big white copy that rises in row by row:
 *   "Learn, grow, [Win.]  Take the first step with us"
 * where a white box keeps sweeping left -> right behind "Win.". A flower, a
 * starburst and a squiggle (all SVG) float and breathe around it, together with
 * a few small tags.
 *
 * At the bottom a ring fills over LOAD_MS (2s) around a breathing dot, under the
 * message "We're making things ready for you". When the ring completes the dot
 * floods the whole screen (white -> QUIZ_COVER_COLOR) and the screen hands over to
 * the Daily Challenge page, which fades the same colour away slowly (RevealCover)
 * — so the illustration screen is gone and the page underneath is revealed.
 *
 * Animations are shortened / paused when the device's "reduce motion" is on.
 */
export default function DailyQuizIntroPage({ navigation }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  // Real size of the screen (falls back to the window until the first layout).
  const [box, setBox] = useState({ w: winW, h: winH });
  const width = box.w;
  const height = box.h;

  // Type scale follows the screen, capped for tablets / web and for short phones.
  const fs = Math.min(width * 0.15, height * 0.078, 68);
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

  // Where the loader sits (centre of the ring / dot), measured from the screen's top-left.
  const cx = width / 2;
  const cy = height - insets.bottom - LOADER_BOTTOM - TEXT_LINE - TEXT_GAP - RING / 2;
  // A circle this big covers the whole screen from any point on it.
  const COVER_D = Math.ceil(Math.hypot(width, height) * 2);

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

  // Loader: progress (ring) -> expand (dot floods the screen) -> hand over.
  const progress = useRef(new Animated.Value(0)).current; // 0 -> 1 over LOAD_MS
  const expand = useRef(new Animated.Value(0)).current; // 0 -> 1 while flooding
  const loaderIn = useRef(new Animated.Value(0)).current; // ring + message fade in
  const loaderOut = useRef(new Animated.Value(0)).current; // ring + message fade out
  const pulse = useLoop(900, 0, reduceMotion);
  const handedOver = useRef(false);

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("MainTabs");
  };

  const handOver = () => {
    if (handedOver.current) return;
    handedOver.current = true;
    // Going to the existing Daily Challenge route pops this screen; the new param
    // tells that page to play its slow reveal.
    navigation.navigate("DailyChallenge", { revealAt: Date.now() });
  };

  useEffect(() => {
    // Everything that touches the loader's opacity is JS-driven (it is combined with
    // `expand`, which animates colour and so can't be native); only the dot's pulse is native.
    const fadeIn = Animated.timing(loaderIn, {
      toValue: 1,
      duration: 350,
      delay: 250,
      useNativeDriver: false,
    });
    const run = Animated.sequence([
      // The 2-second timer: the ring fills.
      Animated.timing(progress, {
        toValue: 1,
        duration: LOAD_MS,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
      // Then the dot floods the screen while the ring + message disappear.
      Animated.parallel([
        Animated.timing(expand, {
          toValue: 1,
          duration: reduceMotion ? 250 : EXPAND_MS,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(loaderOut, {
          toValue: 1,
          duration: 220,
          useNativeDriver: false,
        }),
      ]),
    ]);
    fadeIn.start();
    run.start(({ finished }) => {
      if (finished) handOver();
    });
    return () => {
      fadeIn.stop();
      run.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  // Ring: strokeDashoffset runs full -> 0.
  const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [RING_C, 0] });

  // Ring + message: fade in, later fade out.
  const loaderOpacity = useMemo(
    () =>
      Animated.multiply(
        loaderIn,
        loaderOut.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      ),
    [loaderIn, loaderOut],
  );

  // Dot: breathes while loading; swapped for the flood circle the instant expansion starts.
  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.25] });
  const dotOpacity = useMemo(
    () =>
      Animated.multiply(
        loaderIn,
        expand.interpolate({ inputRange: [0, 0.001], outputRange: [1, 0], extrapolate: "clamp" }),
      ),
    [loaderIn, expand],
  );

  // Flood circle: starts exactly the size of the dot, grows past the screen corners,
  // and turns from white into the cover colour on the way.
  const floodScale = expand.interpolate({ inputRange: [0, 1], outputRange: [DOT / COVER_D, 1] });
  const floodOpacity = expand.interpolate({ inputRange: [0, 0.001, 1], outputRange: [0, 1, 1] });
  const floodColor = expand.interpolate({
    inputRange: [0, 0.7],
    outputRange: ["#FFFFFF", QUIZ_COVER_COLOR],
    extrapolate: "clamp",
  });

  return (
    <View
      style={styles.root}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w && h && (Math.abs(w - box.w) > 1 || Math.abs(h - box.h) > 1)) setBox({ w, h });
      }}
    >
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
          style={[styles.flower, { top: moderateScale(52), right: -flowerSize * 0.1 }]}
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

      {/* ── loader (bottom): ring fills over 2s around a breathing dot ─────── */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          { left: cx - RING / 2, top: cy - RING / 2, opacity: loaderOpacity },
        ]}
      >
        <Svg width={RING} height={RING}>
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={RING_R}
            stroke="rgba(255,255,255,0.28)"
            strokeWidth={RING_STROKE}
            fill="none"
          />
          <G rotation="-90" origin={`${RING / 2}, ${RING / 2}`}>
            <AnimatedCircle
              cx={RING / 2}
              cy={RING / 2}
              r={RING_R}
              stroke={Colors.white}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${RING_C} ${RING_C}`}
              strokeDashoffset={dashOffset}
            />
          </G>
        </Svg>
      </Animated.View>

      {/* outer view: JS-driven opacity; inner view: native-driven breathing */}
      <Animated.View
        pointerEvents="none"
        style={{ position: "absolute", left: cx - DOT / 2, top: cy - DOT / 2, opacity: dotOpacity }}
      >
        <Animated.View style={[styles.dot, { transform: [{ scale: dotScale }] }]} />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.message,
          { bottom: insets.bottom + LOADER_BOTTOM, opacity: loaderOpacity },
        ]}
      >
        <Text style={styles.messageText} accessibilityLiveRegion="polite">
          We’re making things ready for you
        </Text>
        <Ellipsis style={styles.messageText} paused={reduceMotion} />
      </Animated.View>

      {/* ── flood: starts as the dot, grows to cover the screen ─────────────── */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: COVER_D,
          height: COVER_D,
          borderRadius: COVER_D / 2,
          left: cx - COVER_D / 2,
          top: cy - COVER_D / 2,
          backgroundColor: floodColor,
          opacity: floodOpacity,
          transform: [{ scale: floodScale }],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BLUE_DEEP, overflow: "hidden" },
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

  // The copy block is centred in the space above the loader, so it sits higher than
  // before: the big bottom padding reserves the loader's room and lifts the text.
  copy: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: moderateScale(24),
    paddingBottom: RING + TEXT_GAP + TEXT_LINE + LOADER_BOTTOM + moderateScale(40),
  },
  row: { position: "relative" },

  // "Win." highlight
  winWrap: {
    alignSelf: "flex-start",
    overflow: "hidden",
    borderRadius: 4,
  },
  winPad: { paddingHorizontal: moderateScale(8) },
  winBox: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: Colors.white,
    overflow: "hidden",
  },
  winInner: { position: "absolute", top: 0, bottom: 0 },

  // doodle placement
  flower: { position: "absolute" },
  pillSlot: { position: "absolute" },
  burstSlot: { position: "absolute", left: 0 },
  pill: { borderRadius: 99 },

  // loader
  ring: { position: "absolute", width: RING, height: RING },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: Colors.white,
  },
  message: {
    position: "absolute",
    left: 0,
    right: 0,
    height: TEXT_LINE,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  messageText: {
    color: Colors.white,
    fontSize: 15,
    lineHeight: TEXT_LINE,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  ellipsis: { width: 18, textAlign: "left" },
});
