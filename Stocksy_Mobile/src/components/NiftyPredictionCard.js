import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";

import useNiftyPrediction from "../hooks/useNiftyPrediction";
import {
  DIRECTION,
  directionFromProgress,
  getCardCopy,
  getStreakLabel,
  toProgress,
} from "../utils/niftyPrediction";
import { Colors, Shadows, fontScale, moderateScale } from "../theme";

// The native animation driver doesn't exist on web; asking for it there only
// logs a warning per animation.
const NATIVE = Platform.OS !== "web";

const TRACK_H = moderateScale(68);
const PAD = moderateScale(6);
const THUMB = TRACK_H - PAD * 2;

const UP = Colors.gain; // "#00D09C"
const DOWN = "#FF5C6C";
const AMBER = "#FBBF24";

const TONE_ACCENT = {
  live: Colors.primaryAccent,
  win: UP,
  loss: DOWN,
  flat: AMBER,
  muted: "#64748B",
  idle: Colors.primaryAccent,
};

const springTo = (value, toValue, extra = {}) =>
  Animated.spring(value, { toValue, useNativeDriver: NATIVE, friction: 7, tension: 90, ...extra });

/**
 * NiftyPredictionCard — the daily "up or down?" call.
 *
 * Hold the middle circle and drag it left (down) or right (up). Past the
 * commit point it locks in; short of it, it springs back. Everything else on
 * the card — the words, the countdown, the result, the streak — follows the
 * phase the server and the clock say we're in (see utils/niftyPrediction.js).
 *
 * Props:
 *   niftyLtp     number  — live Nifty price, shown on the card (optional)
 *   niftyChange  { label, isPositive } — today's move, shown beside it (optional)
 */
export default function NiftyPredictionCard({ niftyLtp, niftyChange, style }) {
  const { state, phase, loading, failed, submitting, remainingMs, streak, prediction, submit, reload } =
    useNiftyPrediction();

  // Tab screens stay mounted; refresh when the dashboard comes back into view.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useFocusEffect(
    useCallback(() => {
      reloadRef.current();
    }, []),
  );

  const copy = useMemo(() => getCardCopy({ state, phase, remainingMs }), [state, phase, remainingMs]);
  const canSlide = copy.canSlide && !submitting && !loading;
  const accent = TONE_ACCENT[copy.tone] || TONE_ACCENT.idle;

  // ── geometry ───────────────────────────────────────────────────────────────
  const [trackWidth, setTrackWidth] = useState(0);
  const maxTravel = Math.max((trackWidth - THUMB) / 2 - PAD, 1);

  const x = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const nudge = useRef(new Animated.Value(0)).current;

  // The gesture handlers are created once, so they read live values from refs.
  const maxRef = useRef(maxTravel);
  maxRef.current = maxTravel;
  const canSlideRef = useRef(canSlide);
  canSlideRef.current = canSlide;
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const committing = useRef(false);
  const dragging = useRef(false);

  const lockedDirection = prediction ? prediction.direction : null;

  // Rest position: centre when there's no call, pinned to the chosen side once
  // there is one. Skipped mid-drag / mid-commit so it never fights the finger.
  useEffect(() => {
    if (dragging.current || committing.current) return;
    const rest = lockedDirection === DIRECTION.UP ? maxTravel : lockedDirection === DIRECTION.DOWN ? -maxTravel : 0;
    springTo(x, rest).start();
  }, [lockedDirection, maxTravel, x, phase]);

  // A little pop when a call lands.
  const prevLocked = useRef(lockedDirection);
  useEffect(() => {
    if (!prevLocked.current && lockedDirection) {
      Animated.sequence([
        Animated.timing(pop, { toValue: 1.18, duration: 140, useNativeDriver: NATIVE }),
        springTo(pop, 1, { friction: 4 }),
      ]).start();
    }
    prevLocked.current = lockedDirection;
  }, [lockedDirection, pop]);

  // Idle invitation: the side chevrons breathe while a call can be made.
  useEffect(() => {
    if (!canSlide) {
      nudge.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(nudge, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
        Animated.timing(nudge, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [canSlide, nudge]);

  const commit = useCallback(
    async (direction) => {
      committing.current = true;
      const max = maxRef.current;
      springTo(x, direction === DIRECTION.UP ? max : -max).start();
      const ok = await submitRef.current(direction);
      committing.current = false;
      // Refused (window just locked, no price…): the card refetched and will
      // re-rest the thumb; if it's still centred-able, bring it home now.
      if (!ok) springTo(x, 0).start();
    },
    [x],
  );
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => canSlideRef.current && !committing.current,
      onStartShouldSetPanResponderCapture: () => canSlideRef.current && !committing.current,
      onMoveShouldSetPanResponder: () => canSlideRef.current && !committing.current,
      onMoveShouldSetPanResponderCapture: () => canSlideRef.current && !committing.current,
      onPanResponderGrant: () => {
        dragging.current = true;
        Animated.spring(pop, { toValue: 1.08, useNativeDriver: NATIVE, friction: 6 }).start();
      },
      onPanResponderMove: (_, g) => {
        if (!canSlideRef.current) return;
        const max = maxRef.current;
        x.setValue(Math.max(-max, Math.min(max, g.dx)));
      },
      onPanResponderRelease: (_, g) => {
        dragging.current = false;
        springTo(pop, 1).start();
        if (!canSlideRef.current) {
          springTo(x, 0).start();
          return;
        }
        const direction = directionFromProgress(toProgress(g.dx, maxRef.current));
        if (direction) commitRef.current(direction);
        else springTo(x, 0).start();
      },
      // The ScrollView may steal the gesture mid-drag: go home rather than strand the thumb.
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        dragging.current = false;
        springTo(pop, 1).start();
        if (!committing.current) springTo(x, 0).start();
      },
    }),
  ).current;

  // ── colours that follow the thumb ──────────────────────────────────────────
  const m = Math.max(maxTravel, 1);
  const downGlow = x.interpolate({ inputRange: [-m, 0], outputRange: [1, 0], extrapolate: "clamp" });
  const upGlow = x.interpolate({ inputRange: [0, m], outputRange: [0, 1], extrapolate: "clamp" });
  const neutralIcon = x.interpolate({ inputRange: [-m * 0.45, 0, m * 0.45], outputRange: [0, 1, 0], extrapolate: "clamp" });
  const downIcon = x.interpolate({ inputRange: [-m * 0.7, -m * 0.3], outputRange: [1, 0], extrapolate: "clamp" });
  const upIcon = x.interpolate({ inputRange: [m * 0.3, m * 0.7], outputRange: [0, 1], extrapolate: "clamp" });
  const chevronPulse = nudge.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  // Accessibility: a screen-reader user can't drag, so expose the two calls as actions.
  const onAccessibilityAction = (e) => {
    if (!canSlideRef.current || committing.current) return;
    const name = e.nativeEvent.actionName;
    if (name === "increment") commitRef.current(DIRECTION.UP);
    if (name === "decrement") commitRef.current(DIRECTION.DOWN);
  };

  const settled = !canSlide;
  const statusTint =
    copy.tone === "win" ? UP : copy.tone === "loss" ? DOWN : copy.tone === "flat" ? AMBER : null;
  // Once a result is in, the card is tinted by the OUTCOME, not by the side the
  // thumb is pinned to (a lost UP call must not glow green).
  const resolved = phase === "RESOLVED";
  // The big side glow is only for the live drag; once locked, the track tint carries it.
  const glowScale = resolved || lockedDirection ? 0 : 0.4;
  const hintText = submitting ? "Locking in your call…" : copy.hint;

  return (
    <LinearGradient
      colors={["#16224A", "#0D1431", "#0A0F24"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, style]}
    >
      {/* soft glow that takes the colour of the side you're leaning to */}
      <Animated.View pointerEvents="none" style={[styles.glow, styles.glowDown, { opacity: Animated.multiply(downGlow, glowScale * 0.5) }]} />
      <Animated.View pointerEvents="none" style={[styles.glow, styles.glowUp, { opacity: Animated.multiply(upGlow, glowScale * 0.5) }]} />

      {/* top row: eyebrow + streak */}
      <View style={styles.topRow}>
        <View style={[styles.eyebrow, { borderColor: accent + "55", backgroundColor: accent + "1F" }]}>
          <Ionicons name="sparkles" size={moderateScale(11)} color={accent} />
          <Text style={[styles.eyebrowText, { color: accent }]}>{copy.eyebrow}</Text>
        </View>

        {streak ? (
          <View style={styles.streakChip}>
            <Ionicons
              name="flame"
              size={moderateScale(14)}
              color={streak.current > 0 ? "#FB923C" : "#64748B"}
            />
            <Text style={styles.streakText}>{getStreakLabel(streak)}</Text>
          </View>
        ) : null}
      </View>

      {/* words */}
      <Text style={styles.title} numberOfLines={2}>
        {copy.title}
      </Text>
      <Text style={styles.subtitle} numberOfLines={2}>
        {failed && !state ? "We couldn't load today's call." : copy.subtitle}
      </Text>

      {/* live Nifty */}
      {niftyLtp ? (
        <View style={styles.niftyRow}>
          <Text style={styles.niftyLabel}>NIFTY 50</Text>
          <Text style={styles.niftyPrice}>₹{Number(niftyLtp).toLocaleString("en-IN")}</Text>
          {niftyChange?.label ? (
            <Text style={[styles.niftyChange, { color: niftyChange.isPositive ? UP : DOWN }]}>
              {niftyChange.label}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* the slider */}
      <View
        style={[styles.track, settled && styles.trackSettled]}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: DOWN, opacity: Animated.multiply(downGlow, glowScale * 0.32) }]} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: UP, opacity: Animated.multiply(upGlow, glowScale * 0.32) }]} />

        {/* side labels */}
        <View pointerEvents="none" style={[styles.sideLabel, { left: PAD + THUMB * 0.35 }]}>
          <Animated.View style={{ opacity: canSlide ? chevronPulse : 0.5 }}>
            <Ionicons name="chevron-back" size={moderateScale(16)} color={DOWN} />
          </Animated.View>
          <Text style={[styles.sideText, { color: DOWN }]}>DOWN</Text>
        </View>
        <View pointerEvents="none" style={[styles.sideLabel, { right: PAD + THUMB * 0.35 }]}>
          <Text style={[styles.sideText, { color: UP }]}>UP</Text>
          <Animated.View style={{ opacity: canSlide ? chevronPulse : 0.5 }}>
            <Ionicons name="chevron-forward" size={moderateScale(16)} color={UP} />
          </Animated.View>
        </View>

        {/* result tint (win / loss / flat) */}
        {resolved && statusTint ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: statusTint, opacity: 0.16 }]} />
        ) : null}

        {/* the thumb */}
        <Animated.View
          {...pan.panHandlers}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Nifty prediction"
          accessibilityHint="Swipe up to predict Nifty will rise, swipe down to predict it will fall"
          accessibilityActions={canSlide ? [{ name: "increment", label: "Predict up" }, { name: "decrement", label: "Predict down" }] : []}
          onAccessibilityAction={onAccessibilityAction}
          style={[
            styles.thumb,
            Platform.OS === "web" && styles.thumbWeb,
            { transform: [{ translateX: x }, { scale: pop }] },
            lockedDirection && { shadowColor: lockedDirection === DIRECTION.UP ? UP : DOWN },
          ]}
        >
          <Animated.View style={[styles.thumbIcon, { opacity: neutralIcon }]}>
            <Ionicons name="swap-horizontal" size={moderateScale(24)} color="#0A0F24" />
          </Animated.View>
          <Animated.View style={[styles.thumbIcon, { opacity: downIcon }]}>
            <Ionicons name="trending-down" size={moderateScale(26)} color={DOWN} />
          </Animated.View>
          <Animated.View style={[styles.thumbIcon, { opacity: upIcon }]}>
            <Ionicons name="trending-up" size={moderateScale(26)} color="#00A87D" />
          </Animated.View>
        </Animated.View>
      </View>

      {/* countdown / status, under the track so the thumb never covers it */}
      {hintText ? (
        <View style={styles.hintRow}>
          {submitting ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Ionicons name="time-outline" size={moderateScale(13)} color={statusTint || "rgba(148,163,184,0.9)"} />
          )}
          <Text style={[styles.hintText, statusTint && { color: statusTint }]} numberOfLines={1}>
            {hintText}
          </Text>
        </View>
      ) : null}

      {/* couldn't load and nothing to show: let them retry */}
      {failed && !state ? (
        <TouchableOpacity onPress={reload} style={styles.retry} activeOpacity={0.8}>
          <Ionicons name="refresh" size={moderateScale(14)} color={Colors.primaryAccent} />
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: moderateScale(20),
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    ...Shadows.floating,
  },
  glow: {
    position: "absolute",
    width: moderateScale(220),
    height: moderateScale(220),
    borderRadius: moderateScale(110),
    top: moderateScale(40),
  },
  glowDown: { left: -moderateScale(90), backgroundColor: DOWN },
  glowUp: { right: -moderateScale(90), backgroundColor: UP },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: moderateScale(14),
  },
  eyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(5),
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(5),
    borderRadius: 999,
    borderWidth: 1,
  },
  eyebrowText: {
    fontSize: fontScale(10.5),
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  streakChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(5),
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(5),
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  streakText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: fontScale(11.5),
    fontWeight: "600",
  },

  title: {
    color: Colors.white,
    fontSize: fontScale(24),
    fontWeight: "800",
    letterSpacing: -0.4,
    lineHeight: fontScale(30),
  },
  subtitle: {
    color: "rgba(226,232,240,0.7)",
    fontSize: fontScale(13),
    lineHeight: fontScale(19),
    marginTop: moderateScale(6),
  },

  niftyRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: moderateScale(8),
    marginTop: moderateScale(14),
  },
  niftyLabel: {
    color: "rgba(148,163,184,0.9)",
    fontSize: fontScale(10.5),
    fontWeight: "700",
    letterSpacing: 1,
  },
  niftyPrice: { color: Colors.white, fontSize: fontScale(14), fontWeight: "700" },
  niftyChange: { fontSize: fontScale(12), fontWeight: "700" },

  track: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    marginTop: moderateScale(20),
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  trackSettled: { backgroundColor: "rgba(255,255,255,0.045)" },
  sideLabel: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(2),
  },
  sideText: { fontSize: fontScale(12), fontWeight: "800", letterSpacing: 1.4 },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(6),
    marginTop: moderateScale(12),
  },
  hintText: {
    color: "rgba(203,213,225,0.85)",
    fontSize: fontScale(12),
    fontWeight: "600",
  },

  thumb: {
    position: "absolute",
    left: "50%",
    marginLeft: -THUMB / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  thumbWeb: { cursor: "grab", touchAction: "none", userSelect: "none" },
  thumbIcon: { position: "absolute", alignItems: "center", justifyContent: "center" },

  retry: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(6),
    marginTop: moderateScale(14),
    padding: moderateScale(6),
  },
  retryText: { color: Colors.primaryAccent, fontSize: fontScale(12.5), fontWeight: "700" },
});
