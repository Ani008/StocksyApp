import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from "react-native-svg";

import { Colors } from "../theme";

// The native animation driver doesn't exist on web; asking for it there only
// logs a warning per animation, and this component runs several at once.
const NATIVE = Platform.OS !== "web";

// SVG ids are global in the browser, so each flame needs its own or two flames
// with different colours would pick up each other's gradients.
let flameCount = 0;

const VIEW_W = 100;
const VIEW_H = 120;

const OUTER =
  "M50 4 C 52 22, 80 34, 82 70 C 83 98, 68 116, 50 116 C 32 116, 17 98, 18 70 C 19 54, 27 46, 33 36 C 35 46, 41 50, 45 51 C 42 36, 43 17, 50 4 Z";
const MID =
  "M51 46 C 53 62, 70 68, 70 90 C 70 104, 62 112, 50 112 C 38 112, 30 104, 30 90 C 30 76, 40 70, 44 60 C 47 56, 49 52, 51 46 Z";
const CORE =
  "M50 72 C 51 84, 61 88, 61 99 C 61 106, 56 110, 50 110 C 44 110, 39 106, 39 99 C 39 92, 45 88, 47 82 C 48 79, 49 76, 50 72 Z";

// Shared with FlameIcon so the small icon is the same flame.
export const FLAME_PATHS = { outer: OUTER, mid: MID, core: CORE, width: VIEW_W, height: VIEW_H };

const LIT = {
  outer: [Colors.primaryAccent, Colors.primary, Colors.primaryDark],
  mid: [Colors.primaryLight, Colors.primaryAccent],
  core: Colors.white,
  glow: Colors.primary,
};
const OUT = {
  outer: ["#64748B", "#475569", "#334155"],
  mid: ["#94A3B8", "#64748B"],
  core: "#CBD5E1",
  glow: "#64748B",
};

const EMBERS = [
  { x: -0.18, drift: -7, size: 3.5, delay: 0, duration: 2300 },
  { x: 0.12, drift: 6, size: 3, delay: 700, duration: 2700 },
  { x: -0.02, drift: -4, size: 4, delay: 1300, duration: 2500 },
  { x: 0.22, drift: 8, size: 2.5, delay: 1900, duration: 2200 },
  { x: -0.26, drift: 5, size: 2.5, delay: 400, duration: 2900 },
];

const SPARKS = Array.from({ length: 10 }, (_, i) => ({
  angle: (i / 10) * Math.PI * 2 + (i % 2 ? 0.15 : 0),
  distance: 0.78 + (i % 3) * 0.14,
  size: i % 2 ? 4 : 5.5,
}));

/**
 * The streak flame: a blue flame with a light core that flickers and sways,
 * breathes a soft glow and sheds a few embers. When `celebrate` turns true it
 * pops and throws a ring of sparks once.
 *
 *   size       height of the flame in px (width follows)
 *   lit        false renders a dim, still, grey flame (no streak yet)
 *   celebrate  play the one-off burst
 *   onLight    tune glow, embers and sparks for a light background
 */
export default function StreakFlame({ size = 72, lit = true, celebrate = false, onLight = false }) {
  const width = (size * VIEW_W) / VIEW_H;
  const box = size * 2.1; // room for the glow and the burst
  const palette = lit ? LIT : OUT;
  const id = useMemo(() => `flame${flameCount++}`, []);

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => alive && setReduceMotion(!!v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const animated = lit && !reduceMotion;

  const flick = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(lit ? 0.4 : 1)).current;
  const embers = useRef(EMBERS.map(() => new Animated.Value(0))).current;
  const burst = useRef(new Animated.Value(0)).current;

  // Entrance: the flame springs up from small.
  useEffect(() => {
    if (!animated) {
      pop.setValue(1);
      return;
    }
    Animated.spring(pop, {
      toValue: 1,
      friction: 5,
      tension: 90,
      useNativeDriver: NATIVE,
    }).start();
  }, [animated, pop]);

  // Continuous life: flicker, sway, glow and embers each loop on their own
  // period so the motion never visibly repeats in lockstep.
  useEffect(() => {
    if (!animated) return undefined;

    const loop = (value, duration, delay = 0) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.loop(
          Animated.sequence([
            Animated.timing(value, {
              toValue: 1,
              duration,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: NATIVE,
            }),
            Animated.timing(value, {
              toValue: 0,
              duration,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: NATIVE,
            }),
          ]),
        ),
      ]);

    const running = [
      loop(flick, 520),
      loop(sway, 840),
      loop(glow, 1300),
      ...embers.map((v, i) =>
        Animated.sequence([
          Animated.delay(EMBERS[i].delay),
          Animated.loop(
            Animated.timing(v, {
              toValue: 1,
              duration: EMBERS[i].duration,
              easing: Easing.out(Easing.quad),
              useNativeDriver: NATIVE,
            }),
          ),
        ]),
      ),
    ];
    running.forEach((a) => a.start());
    return () => running.forEach((a) => a.stop());
  }, [animated, flick, sway, glow, embers]);

  // One-off celebration.
  useEffect(() => {
    if (!celebrate || !animated) return;
    burst.setValue(0);
    Animated.parallel([
      Animated.timing(burst, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: NATIVE,
      }),
      Animated.sequence([
        Animated.timing(pop, { toValue: 1.18, duration: 160, useNativeDriver: NATIVE }),
        Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: NATIVE }),
      ]),
    ]).start();
  }, [celebrate, animated, burst, pop]);

  const scaleY = flick.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.05] });
  const scaleX = flick.interpolate({ inputRange: [0, 1], outputRange: [1.02, 0.97] });
  // Scaling happens about the centre; this keeps the flame's base planted.
  const lift = flick.interpolate({
    inputRange: [0, 1],
    outputRange: [size * 0.015, -size * 0.025],
  });
  const rotate = sway.interpolate({ inputRange: [0, 1], outputRange: ["-2.5deg", "2.5deg"] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });

  const ringScale = burst.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] });
  const ringOpacity = burst.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.7, 0] });
  const sparkOpacity = burst.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 0.8, 0] });
  const sparkScale = burst.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] });

  return (
    <View
      style={{ width: box, height: box, alignItems: "center", justifyContent: "center" }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={lit ? "Streak flame" : "Streak flame, not lit"}
      pointerEvents="none"
    >
      {/* Soft glow behind everything */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { opacity: lit ? glowOpacity : 0.35, transform: [{ scale: lit ? glowScale : 1 }] },
        ]}
      >
        <Svg width={box} height={box} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={`${id}g`} cx="50" cy="56" r="50" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={palette.glow} stopOpacity={onLight ? "0.3" : "0.55"} />
              <Stop offset="0.55" stopColor={palette.glow} stopOpacity={onLight ? "0.08" : "0.16"} />
              <Stop offset="1" stopColor={palette.glow} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="50" cy="56" r="50" fill={`url(#${id}g)`} />
        </Svg>
      </Animated.View>

      {/* Celebration ring */}
      {animated && (
        <Animated.View
          style={{
            position: "absolute",
            width: size * 1.1,
            height: size * 1.1,
            borderRadius: size,
            borderWidth: 2,
            borderColor: Colors.primaryAccent,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          }}
        />
      )}

      {/* Embers rising off the top */}
      {animated &&
        EMBERS.map((e, i) => {
          const v = embers[i];
          return (
            <Animated.View
              key={i}
              style={{
                position: "absolute",
                width: e.size,
                height: e.size,
                borderRadius: e.size,
                backgroundColor: onLight
                  ? i % 2
                    ? Colors.primaryAccent
                    : Colors.primary
                  : i % 2
                    ? Colors.primaryLight
                    : Colors.primaryAccent,
                left: box / 2 + e.x * size - e.size / 2,
                top: box / 2 - size * 0.1,
                opacity: v.interpolate({
                  inputRange: [0, 0.12, 0.7, 1],
                  outputRange: [0, 0.95, 0.5, 0],
                }),
                transform: [
                  { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.85] }) },
                  {
                    translateX: v.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0, e.drift, -e.drift * 0.5],
                    }),
                  },
                  { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) },
                ],
              }}
            />
          );
        })}

      {/* Burst sparks */}
      {animated &&
        SPARKS.map((s, i) => (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              width: s.size,
              height: s.size,
              borderRadius: s.size,
              backgroundColor: onLight
                ? i % 2
                  ? Colors.primaryDark
                  : Colors.primaryAccent
                : i % 2
                  ? Colors.white
                  : Colors.primaryAccent,
              opacity: sparkOpacity,
              transform: [
                {
                  translateX: burst.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.cos(s.angle) * size * s.distance],
                  }),
                },
                {
                  translateY: burst.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.sin(s.angle) * size * s.distance],
                  }),
                },
                { scale: sparkScale },
              ],
            }}
          />
        ))}

      {/* The flame itself */}
      <Animated.View
        style={{
          width,
          height: size,
          transform: animated
            ? [{ scale: pop }, { translateY: lift }, { rotate }, { scaleX }, { scaleY }]
            : [{ scale: pop }],
        }}
      >
        <Svg width={width} height={size} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
          <Defs>
            <LinearGradient id={`${id}o`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={palette.outer[0]} />
              <Stop offset="0.5" stopColor={palette.outer[1]} />
              <Stop offset="1" stopColor={palette.outer[2]} />
            </LinearGradient>
            <LinearGradient id={`${id}m`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={palette.mid[0]} />
              <Stop offset="1" stopColor={palette.mid[1]} />
            </LinearGradient>
          </Defs>
          <Path d={OUTER} fill={`url(#${id}o)`} />
          <Path d={MID} fill={`url(#${id}m)`} />
          <Path d={CORE} fill={palette.core} opacity={0.92} />
        </Svg>
      </Animated.View>
    </View>
  );
}
