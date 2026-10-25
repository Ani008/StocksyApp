import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, PanResponder, Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Colors, fontScale, moderateScale } from "../theme";

// The native animation driver doesn't exist on web; asking for it there only
// logs a warning per animation.
const NATIVE = Platform.OS !== "web";

const PAD = moderateScale(4);

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

const springTo = (value, toValue) =>
  Animated.spring(value, { toValue, useNativeDriver: NATIVE, friction: 8, tension: 90 });

/**
 * SlideButton — a reusable "slide to go" button.
 *
 * A round thumb sits at the left of a pill-shaped track. Drag it far enough to
 * the right and `onComplete` fires; let go early and it springs back. By default
 * the thumb returns to the start a moment after completing, so the same button
 * can be used again (set `resetOnComplete={false}` to keep it parked at the end).
 *
 * It is purely presentational: it holds no app logic and no navigation, so it
 * can go on any screen or card. Size it with `style` (the track fills its
 * parent's width by default, or pass e.g. { width: 200 }).
 *
 * Props:
 *   label            string    — text on the track (default "Slide to continue")
 *   onComplete       function  — called once when the slide completes (or on
 *                                screen-reader "activate")
 *   icon             string    — Ionicons name on the thumb (default "arrow-forward")
 *   trackColor       string    — track background (default: the app's dark text colour)
 *   thumbColor       string    — thumb background (default white)
 *   iconColor        string    — thumb icon colour (default: trackColor)
 *   textColor        string    — label colour (default white)
 *   height           number    — track height (default moderateScale(52))
 *   threshold        number    — 0..1, how far it must travel to count (default 0.8)
 *   resetOnComplete  bool      — spring back after completing (default true)
 *   resetDelay       number    — ms to wait before springing back (default 700)
 *   loading          bool      — parks the thumb at the end with a spinner;
 *                                springs back when it turns false again
 *   disabled         bool      — dimmed and inert
 *   style            object    — merged onto the track
 *
 * Example:
 *   <SlideButton label="Slide to challenge" onComplete={() => startChallenge()} />
 */
export default function SlideButton({
  label = "Slide to continue",
  onComplete,
  icon = "arrow-forward",
  trackColor = Colors.text,
  thumbColor = Colors.white,
  iconColor,
  textColor = Colors.white,
  height = moderateScale(52),
  threshold = 0.8,
  resetOnComplete = true,
  resetDelay = 700,
  loading = false,
  disabled = false,
  style,
}) {
  const thumbSize = height - PAD * 2;

  const [trackWidth, setTrackWidth] = useState(0);
  const [done, setDone] = useState(false);
  const x = useRef(new Animated.Value(0)).current;

  const maxTravel = Math.max(trackWidth - thumbSize - PAD * 2, 1);
  const interactive = !disabled && !loading && !done;

  // The pan handlers are created once, so they read live values from refs.
  const maxRef = useRef(maxTravel);
  maxRef.current = maxTravel;
  const activeRef = useRef(interactive);
  activeRef.current = interactive;
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const resetOnCompleteRef = useRef(resetOnComplete);
  resetOnCompleteRef.current = resetOnComplete;
  const resetDelayRef = useRef(resetDelay);
  resetDelayRef.current = resetDelay;

  const firedRef = useRef(false); // guards against double-firing onComplete
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const reset = useCallback(() => {
    clearTimeout(timerRef.current);
    firedRef.current = false;
    setDone(false);
    springTo(x, 0).start();
  }, [x]);

  const finish = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    setDone(true);
    springTo(x, maxRef.current).start();
    completeRef.current?.();
    if (resetOnCompleteRef.current) {
      timerRef.current = setTimeout(reset, resetDelayRef.current);
    }
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // loading: park at the end; when it clears, come home so it can be tried again.
  const prevLoading = useRef(loading);
  useEffect(() => {
    if (loading) {
      springTo(x, maxRef.current).start();
    } else if (prevLoading.current) {
      reset();
    }
    prevLoading.current = loading;
  }, [loading, reset, x]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => activeRef.current,
      onStartShouldSetPanResponderCapture: () => activeRef.current,
      onMoveShouldSetPanResponder: () => activeRef.current,
      onMoveShouldSetPanResponderCapture: () => activeRef.current,
      onPanResponderMove: (_, g) => {
        if (!activeRef.current) return;
        x.setValue(clamp(g.dx, 0, maxRef.current));
      },
      onPanResponderRelease: (_, g) => {
        if (!activeRef.current) return;
        const max = maxRef.current;
        const progress = clamp(g.dx, 0, max) / max;
        if (progress >= thresholdRef.current) finishRef.current();
        else springTo(x, 0).start();
      },
      // A parent ScrollView may try to steal the gesture: go home rather than strand the thumb.
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        if (!firedRef.current) springTo(x, 0).start();
      },
    }),
  ).current;

  // The label fades out as the thumb travels across it.
  const labelOpacity = x.interpolate({
    inputRange: [0, Math.max(maxTravel * 0.6, 1)],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  // Screen-reader users can't drag, so a plain "activate" does the same job.
  const onAccessibilityAction = (e) => {
    if (e.nativeEvent.actionName === "activate" && activeRef.current) finishRef.current();
  };

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Slide right, or double tap, to confirm"
      accessibilityState={{ disabled: disabled || loading }}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={onAccessibilityAction}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      style={[
        styles.track,
        {
          height,
          borderRadius: height / 2,
          backgroundColor: trackColor,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {/* label: centred in the space to the right of the thumb */}
      <Animated.View
        pointerEvents="none"
        style={[styles.labelWrap, { paddingLeft: thumbSize + PAD, opacity: labelOpacity }]}
      >
        <Text style={[styles.label, { color: textColor }]} numberOfLines={1}>
          {label}
        </Text>
        <Ionicons name="chevron-forward" size={moderateScale(16)} color={textColor} style={styles.chevron} />
      </Animated.View>

      {/* thumb */}
      <Animated.View
        {...pan.panHandlers}
        style={[
          styles.thumb,
          Platform.OS === "web" && styles.thumbWeb,
          {
            width: thumbSize,
            height: thumbSize,
            borderRadius: thumbSize / 2,
            backgroundColor: thumbColor,
            transform: [{ translateX: x }],
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={iconColor || trackColor} />
        ) : (
          <Ionicons
            name={done ? "checkmark" : icon}
            size={moderateScale(22)}
            color={iconColor || trackColor}
          />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    justifyContent: "center",
    overflow: "hidden",
    alignSelf: "stretch",
  },
  labelWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingRight: PAD,
  },
  label: {
    fontSize: fontScale(15),
    fontWeight: "700",
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  chevron: { marginLeft: moderateScale(2) },
  thumb: {
    marginLeft: PAD,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  thumbWeb: { cursor: "grab", touchAction: "none", userSelect: "none" },
});
