import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text } from "react-native";

import AppModal from "./AppModal";
import StreakFlame from "./StreakFlame";
import { Colors, SCREEN_WIDTH, moderateScale } from "../theme";

const NATIVE = Platform.OS !== "web";

const FADE_IN = 320;
const HOLD = 2300; // time on screen after the fade-in finishes
const FADE_OUT = 520;

const FLAME_SIZE = Math.min(SCREEN_WIDTH * 0.42, 190);

/**
 * Full-screen "Day N" moment shown the first time the app is opened on a new
 * day: the screen dims, a big blue flame and the day number appear, then it
 * all fades away by itself. Tapping skips it.
 *
 *   day      the streak length to announce
 *   message  one line shown under the number
 *   onDone   called once when it has gone (finished or skipped)
 */
export default function StreakWelcomeOverlay({ day, message, onDone }) {
  const fade = useRef(new Animated.Value(0)).current;
  const title = useRef(new Animated.Value(0)).current;
  const sub = useRef(new Animated.Value(0)).current;
  const finished = useRef(false);
  const running = useRef(null);

  // Always calls the latest onDone, and only ever once (finished or skipped).
  const finish = useRef(null);
  finish.current = () => {
    if (finished.current) return;
    finished.current = true;
    onDone?.();
  };

  const fadeOut = (duration = FADE_OUT) => {
    running.current?.stop();
    running.current = Animated.timing(fade, {
      toValue: 0,
      duration,
      easing: Easing.in(Easing.quad),
      useNativeDriver: NATIVE,
    });
    running.current.start(() => finish.current());
  };

  useEffect(() => {
    running.current = Animated.sequence([
      Animated.timing(fade, {
        toValue: 1,
        duration: FADE_IN,
        easing: Easing.out(Easing.quad),
        useNativeDriver: NATIVE,
      }),
      Animated.parallel([
        // The number lands a beat after the flame, with a little bounce.
        Animated.sequence([
          Animated.delay(250),
          Animated.spring(title, { toValue: 1, friction: 5, tension: 110, useNativeDriver: NATIVE }),
        ]),
        Animated.sequence([
          Animated.delay(650),
          Animated.timing(sub, { toValue: 1, duration: 400, useNativeDriver: NATIVE }),
        ]),
        Animated.delay(HOLD),
      ]),
      Animated.timing(fade, {
        toValue: 0,
        duration: FADE_OUT,
        easing: Easing.in(Easing.quad),
        useNativeDriver: NATIVE,
      }),
    ]);
    running.current.start(({ finished: ok }) => {
      if (ok) finish.current();
    });
    return () => running.current?.stop();
  }, [fade, title, sub]);

  return (
    <AppModal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => fadeOut(200)}
    >
      <Pressable
        style={styles.fill}
        onPress={() => fadeOut(220)}
        accessibilityRole="button"
        accessibilityLabel={`Day ${day} streak. Tap to continue`}
      >
        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <StreakFlame size={FLAME_SIZE} lit celebrate />

          <Animated.Text
            style={[
              styles.title,
              {
                opacity: title,
                transform: [
                  { scale: title.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
                  { translateY: title.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                ],
              },
            ]}
          >
            Day {day}
          </Animated.Text>

          {!!message && (
            <Animated.Text style={[styles.message, { opacity: sub }]}>{message}</Animated.Text>
          )}
        </Animated.View>
      </Pressable>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    // Dark but see-through, so the dashboard is still faintly there behind it.
    backgroundColor: "rgba(2,4,12,0.92)",
    paddingHorizontal: moderateScale(32),
  },
  title: {
    marginTop: -moderateScale(24),
    color: Colors.white,
    fontSize: moderateScale(64),
    lineHeight: moderateScale(72),
    fontWeight: "800",
    letterSpacing: -1,
    textShadowColor: "rgba(59,130,246,0.75)",
    textShadowRadius: 24,
    textShadowOffset: { width: 0, height: 0 },
  },
  message: {
    marginTop: moderateScale(8),
    color: Colors.primaryAccent,
    fontSize: moderateScale(16),
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 23,
  },
});
