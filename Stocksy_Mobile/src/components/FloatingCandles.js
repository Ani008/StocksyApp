import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { Colors, moderateScale } from "../theme";

// The native animation driver doesn't exist on web; asking for it there only
// logs a warning per animation.
const NATIVE = Platform.OS !== "web";

const GREEN = { light: "#6EF0CF", mid: Colors.gain, deep: "#00A87D" };
const RED = { light: "#FF9AA2", mid: Colors.danger, deep: Colors.dangerDark };

/** Honour the device's "reduce motion" setting: the candles then stay still. */
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

/** A 0 <-> 1 value that eases back and forth forever (starting `phase` of the way in). */
function useLoop(duration, phase, paused) {
  const v = useRef(new Animated.Value(phase)).current;
  useEffect(() => {
    if (paused) {
      v.setValue(0.5);
      return undefined;
    }
    const ease = Easing.inOut(Easing.sin);
    // Start from the phase offset so the candles never move in lockstep.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: duration * (1 - phase), easing: ease, useNativeDriver: NATIVE }),
        Animated.timing(v, { toValue: 0, duration, easing: ease, useNativeDriver: NATIVE }),
        Animated.timing(v, { toValue: phase, duration: duration * phase, easing: ease, useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, duration, phase, paused]);
  return v;
}

/**
 * One floating candle: wick, glossy body, glow halo, and a shadow on the "floor"
 * that shrinks as the candle rises.
 */
function Candle({ palette, bodyW, bodyH, wickTop, wickBottom, left, top, tilt, floatBy, floatMs, breatheMs, phase, shadowTop, paused }) {
  const float = useLoop(floatMs, phase, paused);
  const breathe = useLoop(breatheMs, (phase + 0.35) % 1, paused);

  const H = wickTop + bodyH + wickBottom;
  const WICK = moderateScale(4);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [floatBy, -floatBy] });
  const rotate = float.interpolate({ inputRange: [0, 1], outputRange: [`${tilt - 2.5}deg`, `${tilt + 2.5}deg`] });
  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const halo = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] });
  const haloScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] });
  // Higher candle -> smaller, fainter shadow.
  const shadowScale = float.interpolate({ inputRange: [0, 1], outputRange: [1.08, 0.78] });
  const shadowOpacity = float.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.14] });

  return (
    <>
      {/* floor shadow */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.shadow,
          {
            left: left - bodyW * 0.1,
            top: shadowTop,
            width: bodyW * 1.2,
            backgroundColor: palette.deep,
            opacity: shadowOpacity,
            transform: [{ scaleX: shadowScale }],
          },
        ]}
      />

      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left,
          top,
          width: bodyW,
          height: H,
          transform: [{ translateY }, { rotate }, { scale }],
        }}
      >
        {/* glow halo that breathes: stacked circles fade out softly instead of ending in a hard edge */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: bodyW / 2,
            top: H / 2,
            opacity: halo,
            transform: [{ scale: haloScale }],
          }}
        >
          {[1.2, 1.02, 0.84, 0.66, 0.48].map((r, i) => (
            <View
              key={i}
              style={{
                position: "absolute",
                width: bodyW * 2 * r,
                height: bodyW * 2 * r,
                left: -bodyW * r,
                top: -bodyW * r,
                borderRadius: bodyW * r,
                backgroundColor: palette.mid,
                opacity: 0.17,
              }}
            />
          ))}
        </Animated.View>

        {/* wick: runs the full height, the body sits over its middle */}
        <View
          style={{
            position: "absolute",
            left: (bodyW - WICK) / 2,
            width: WICK,
            height: H,
            borderRadius: WICK / 2,
            backgroundColor: palette.deep,
          }}
        />

        {/* body */}
        <View
          style={[
            styles.bodyShadow,
            {
              top: wickTop,
              width: bodyW,
              height: bodyH,
              backgroundColor: palette.mid,
              shadowColor: palette.mid,
            },
          ]}
        >
          <LinearGradient
            colors={[palette.light, palette.mid, palette.deep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.body}
          >
            {/* gloss */}
            <View
              style={{
                position: "absolute",
                left: bodyW * 0.16,
                top: bodyH * 0.07,
                width: bodyW * 0.2,
                height: bodyH * 0.62,
                borderRadius: bodyW * 0.1,
                backgroundColor: "#FFFFFF",
                opacity: 0.4,
              }}
            />
          </LinearGradient>
        </View>
      </Animated.View>
    </>
  );
}

/**
 * FloatingCandles — one green and one red candlestick that hang in the air,
 * drift up and down, tilt a touch and "breathe" (scale + glow), each on its own
 * rhythm. Purely decorative: hidden from screen readers.
 *
 * It fills a fixed box (CLUSTER_W x CLUSTER_H); position it with `style`.
 */
export const CLUSTER_W = moderateScale(150);
export const CLUSTER_H = moderateScale(228);

export default function FloatingCandles({ style }) {
  const reduce = useReduceMotion();
  const s = moderateScale;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: CLUSTER_W, height: CLUSTER_H }, style]}
    >
      {/* green: the bigger, higher one */}
      <Candle
        palette={GREEN}
        bodyW={s(40)}
        bodyH={s(84)}
        wickTop={s(30)}
        wickBottom={s(22)}
        left={s(86)}
        top={s(4)}
        tilt={8}
        floatBy={s(7)}
        floatMs={3400}
        breatheMs={2600}
        phase={0.1}
        shadowTop={s(166)}
        paused={reduce}
      />
      {/* red: smaller, lower-left, out of step with the green */}
      <Candle
        palette={RED}
        bodyW={s(34)}
        bodyH={s(58)}
        wickTop={s(24)}
        wickBottom={s(34)}
        left={s(20)}
        top={s(84)}
        tilt={-9}
        floatBy={s(8)}
        floatMs={2900}
        breatheMs={3100}
        phase={0.6}
        shadowTop={s(214)}
        paused={reduce}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: { position: "absolute", height: moderateScale(8), borderRadius: moderateScale(4) },
  bodyShadow: {
    position: "absolute",
    borderRadius: moderateScale(9),
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  body: {
    flex: 1,
    borderRadius: moderateScale(9),
    overflow: "hidden",
  },
});
