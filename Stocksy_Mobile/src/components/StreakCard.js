import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import StreakFlame from "./StreakFlame";
import { Colors, Radius, moderateScale } from "../theme";
import { getDoneRuns } from "../utils/streak";

const NATIVE = Platform.OS !== "web";
const DAY = 34; // diameter of a day circle
const FLAME = moderateScale(68);

const CELL = "#EDF1F7"; // an empty day circle
const TRACK = Colors.primaryLight; // the joined "done" pill
const LONE = "#BFDBFE"; // a checked day that stands on its own

/** Counts up to `value` so a new streak number feels earned. */
function useCountUp(value, enabled) {
  const anim = useRef(new Animated.Value(enabled ? 0 : value)).current;
  const [shown, setShown] = useState(enabled ? 0 : value);

  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setShown(Math.round(v)));
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    if (!enabled) {
      anim.setValue(value);
      setShown(value);
      return undefined;
    }
    const run = Animated.timing(anim, {
      toValue: value,
      duration: Math.min(900, 250 + value * 60),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // drives React state, not a style
    });
    run.start();
    return () => run.stop();
  }, [value, enabled, anim]);

  return shown;
}

function DayCell({ day, index, inRun }) {
  const pop = useRef(new Animated.Value(day.status === "done" ? 0 : 1)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  // Checked days pop in one after another, left to right.
  useEffect(() => {
    if (day.status !== "done") {
      pop.setValue(1);
      return undefined;
    }
    pop.setValue(0);
    const run = Animated.sequence([
      Animated.delay(450 + index * 90),
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 140, useNativeDriver: NATIVE }),
    ]);
    run.start();
    return () => run.stop();
  }, [day.status, index, pop]);

  // Today, not yet checked in: a ring that breathes.
  useEffect(() => {
    if (day.status !== "pending") return undefined;
    const run = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: NATIVE }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: NATIVE }),
      ]),
    );
    run.start();
    return () => run.stop();
  }, [day.status, pulse]);

  const done = day.status === "done";
  const missed = day.status === "missed";

  return (
    <View style={styles.col}>
      <Text style={[styles.dayLabel, day.isToday && styles.dayLabelToday]}>{day.label}</Text>
      <View style={styles.cellBox}>
        {day.status === "pending" && (
          <Animated.View
            style={[
              styles.pulse,
              {
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.15] }),
                transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.28] }) }],
              },
            ]}
          />
        )}
        <Animated.View
          style={[
            styles.cell,
            done && styles.cellDone,
            // A checked day that isn't part of a joined pill gets its own circle.
            // Today's check is a solid blue circle (it sits on the pill when part
            // of a run); other checked days get a pale circle unless they are
            // already inside a joined pill.
            done && day.isToday && styles.cellToday,
            done && !day.isToday && !inRun && styles.cellLone,
            day.isToday && !done && styles.cellToday,
            { transform: [{ scale: pop }] },
          ]}
        >
          {done ? (
            <Ionicons name="checkmark" size={17} color={day.isToday ? Colors.white : Colors.primaryDark} />
          ) : (
            <Text
              style={[
                styles.cellText,
                day.isToday && { color: Colors.white },
                missed && styles.cellTextMissed,
              ]}
            >
              {day.dayNumber}
            </Text>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

/**
 * Compact streak card for the dashboard: flame, animated count, the week at a
 * glance and a one-line message. The full streak page will reuse StreakFlame
 * and the data from useStreak.
 */
export default function StreakCard({ streak, longest, week, message, celebrate, onPress, style }) {
  const lit = streak > 0;
  const count = useCountUp(streak, celebrate || streak > 0);
  const [rowWidth, setRowWidth] = useState(0);

  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    }).start();
  }, [enter]);

  // Count bumps when it ticks up.
  const bump = useRef(new Animated.Value(1)).current;
  const lastCount = useRef(streak);
  useEffect(() => {
    if (streak > lastCount.current) {
      Animated.sequence([
        Animated.timing(bump, { toValue: 1.25, duration: 140, useNativeDriver: NATIVE }),
        Animated.spring(bump, { toValue: 1, friction: 4, tension: 140, useNativeDriver: NATIVE }),
      ]).start();
    }
    lastCount.current = streak;
  }, [streak, bump]);

  // The joined pill behind each run of consecutive checked days.
  const runs = useMemo(() => getDoneRuns(week), [week]);
  const colW = rowWidth / 7;
  const grow = useRef(new Animated.Value(0)).current;
  const runKey = runs.map((r) => r.join("-")).join("|");
  useEffect(() => {
    grow.setValue(0);
    if (!runs.length) return undefined;
    const run = Animated.timing(grow, {
      toValue: 1,
      duration: 500,
      delay: 350,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // animates width
    });
    run.start();
    return () => run.stop();
  }, [runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Animated.View
      style={[
        styles.card,
        style,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        },
      ]}
    >
      <Wrapper
        {...(onPress
          ? { onPress, activeOpacity: 0.85, accessibilityRole: "button", accessibilityLabel: `${streak} day streak. Open streak details` }
          : {})}
      >
        <View style={styles.topRow}>
          <View style={styles.flameBox}>
            <StreakFlame size={FLAME} lit={lit} celebrate={celebrate} onLight />
          </View>

          <View style={styles.countBlock}>
            <View style={styles.countRow}>
              <Animated.Text style={[styles.count, !lit && styles.countOff, { transform: [{ scale: bump }] }]}>
                {count}
              </Animated.Text>
              <Text style={styles.unit}>{streak === 1 ? "day streak" : "days streak"}</Text>
            </View>
            {longest > 0 && (
              <View style={styles.bestChip}>
                <Ionicons name="trophy-outline" size={11} color={Colors.primaryDark} />
                <Text style={styles.bestText}>Best {longest}</Text>
              </View>
            )}
          </View>

          {onPress && <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />}
        </View>

        <View style={styles.weekBox}>
          <View style={styles.weekRow} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
            {rowWidth > 0 &&
              runs.map(([from, to]) => (
                <Animated.View
                  key={`${from}-${to}`}
                  style={[
                    styles.runPill,
                    {
                      left: from * colW + (colW - DAY) / 2,
                      width: grow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [DAY, (to - from) * colW + DAY],
                      }),
                    },
                  ]}
                />
              ))}
            {week.map((day, i) => (
              <DayCell
                key={day.key}
                day={day}
                index={i}
                inRun={runs.some(([from, to]) => i >= from && i <= to)}
              />
            ))}
          </View>
        </View>

        <View style={styles.divider} />
        <Text style={styles.message}>{message}</Text>
      </Wrapper>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    // Same look as the other cards on the Profile page.
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: moderateScale(16),
    overflow: "hidden",
    shadowColor: Colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  topRow: { flexDirection: "row", alignItems: "center" },
  flameBox: {
    width: FLAME * 1.15,
    height: FLAME * 1.15,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
    marginRight: moderateScale(8),
  },
  countBlock: { flex: 1 },
  countRow: { flexDirection: "row", alignItems: "flex-end" },
  count: {
    color: Colors.text,
    fontSize: moderateScale(44),
    lineHeight: moderateScale(48),
    fontWeight: "800",
    marginRight: moderateScale(8),
    minWidth: moderateScale(26),
  },
  countOff: { color: Colors.textMuted },
  unit: {
    color: Colors.primary,
    fontSize: moderateScale(18),
    fontWeight: "700",
    marginBottom: moderateScale(6),
  },
  bestChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: moderateScale(4),
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.round,
    backgroundColor: Colors.primaryLight,
  },
  bestText: { color: Colors.primaryDark, fontSize: 11, fontWeight: "700" },

  weekBox: {
    marginTop: moderateScale(14),
    borderRadius: Radius.lg,
    backgroundColor: Colors.background,
    paddingVertical: moderateScale(10),
    paddingHorizontal: moderateScale(6),
  },
  weekRow: { flexDirection: "row", position: "relative" },
  col: { flex: 1, alignItems: "center" },
  dayLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: "600", marginBottom: 6 },
  dayLabelToday: { color: Colors.primaryDark },
  cellBox: { width: DAY, height: DAY, alignItems: "center", justifyContent: "center" },
  cell: {
    width: DAY,
    height: DAY,
    borderRadius: DAY / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CELL,
  },
  cellDone: { backgroundColor: "transparent" },
  cellToday: { backgroundColor: Colors.primary },
  cellLone: { backgroundColor: LONE },
  cellText: { color: Colors.textSecondary, fontSize: 13, fontWeight: "600" },
  cellTextMissed: { color: Colors.textMuted, textDecorationLine: "line-through" },
  pulse: {
    position: "absolute",
    width: DAY,
    height: DAY,
    borderRadius: DAY / 2,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  runPill: {
    position: "absolute",
    // Sits level with the circles: label row (~11px text + 6 margin) above.
    top: 17,
    height: DAY,
    borderRadius: DAY / 2,
    backgroundColor: TRACK,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
    marginTop: moderateScale(12),
    marginBottom: moderateScale(10),
  },
  message: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 19,
  },
});
