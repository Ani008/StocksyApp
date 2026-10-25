import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";

/** True when the device asks apps to cut back on motion. Idle loops should stop. */
export function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((on) => alive && setReduce(!!on))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return reduce;
}

/**
 * A looping 0 -> 1 -> 0 value that eases both ways, so anything driven by it
 * breathes or floats. Parked at the middle when disabled.
 */
export function useLoop(enabled, duration, delay = 0) {
  const v = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (!enabled) {
      v.setValue(0.5);
      return undefined;
    }
    v.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const t = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(t);
      loop.stop();
    };
  }, [enabled, duration, delay, v]);
  return v;
}

/** Map a 0..1 animated value onto any two numbers or angle strings. */
export const range = (v, from, to) => v.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
