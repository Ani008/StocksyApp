import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { Colors } from "../theme";

// Each glow needs its own gradient id: SVG ids are global in the browser.
let glowCount = 0;

/**
 * A soft blue glow, used behind the 1st place avatar.
 *
 * It fades in after `delay`, then slowly "breathes" (grows and dims a little)
 * for as long as it is on screen.
 *
 * Props:
 *   size   width and height of the glow
 *   delay  ms before it starts fading in
 *   style  position it with an absolute style from the parent
 */
export default function LeaderboardGlow({ size = 200, delay = 0, style }) {
  const id = useMemo(() => `leaderboardGlow${glowCount++}`, []);
  const fade = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const fadeIn = Animated.timing(fade, {
      toValue: 1,
      duration: 700,
      delay,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    fadeIn.start();
    pulse.start();
    return () => {
      fadeIn.stop();
      pulse.stop();
    };
  }, [delay, fade, breathe]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] });
  const breatheOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });
  const opacity = Animated.multiply(fade, breatheOpacity);

  return (
    <Animated.View
      style={[
        { width: size, height: size, opacity, transform: [{ scale }], pointerEvents: "none" },
        style,
      ]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={Colors.primaryAccent} stopOpacity={0.6} />
            <Stop offset="0.4" stopColor={Colors.primary} stopOpacity={0.28} />
            <Stop offset="0.75" stopColor={Colors.primary} stopOpacity={0.06} />
            <Stop offset="1" stopColor={Colors.primary} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}
