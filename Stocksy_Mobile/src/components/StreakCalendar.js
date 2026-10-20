import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Colors, moderateScale } from "../theme";
import { formatDateKey, getYearGrid } from "../utils/streak";

const NATIVE = Platform.OS !== "web";

const CELL = 13;
const GAP = 3;
const STEP = CELL + GAP;
const MONTH_ROW = 16;
const LABEL_W = 28;

// Level 0 (nothing) to 4 (most). A check-in is level 3, the brand blue.
const LEVEL_COLORS = ["#EBEFF5", "#BFDBFE", "#93C5FD", Colors.primary, Colors.primaryDark];
const ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

/**
 * GitHub-style year grid: one column per week (Monday at the top), the latest
 * week on the right, one blue square per day. Tap a day to see its date.
 *
 *   today    "YYYY-MM-DD" for today
 *   history  array of "YYYY-MM-DD" keys the person was active on
 */
export default function StreakCalendar({ today, history, style }) {
  const { weeks, months, total } = useMemo(() => getYearGrid(today, history), [today, history]);
  const [selected, setSelected] = useState(null);
  const scroller = useRef(null);

  // Columns fade and rise in one after another, left to right.
  const reveal = useRef(null);
  if (!reveal.current || reveal.current.length !== weeks.length) {
    reveal.current = weeks.map(() => new Animated.Value(0));
  }
  useEffect(() => {
    const run = Animated.stagger(
      12,
      reveal.current.map((v) =>
        Animated.timing(v, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: NATIVE,
        }),
      ),
    );
    run.start();
    return () => run.stop();
  }, [weeks.length]);

  const selectedCell = useMemo(() => {
    if (!selected) return null;
    for (const week of weeks) {
      const hit = week.find((d) => d.key === selected);
      if (hit) return hit;
    }
    return null;
  }, [selected, weeks]);

  let detail = "Swipe for the full year · tap a day for details";
  if (selectedCell) {
    detail = `${formatDateKey(selectedCell.key)} · ${
      selectedCell.count > 0 ? "Checked in" : "No activity"
    }`;
  }

  return (
    <View style={[styles.card, style]}>
      <View style={styles.headRow}>
        <Text style={styles.title}>
          <Text style={styles.titleStrong}>{total}</Text> {total === 1 ? "active day" : "active days"} in the last year
        </Text>
      </View>

      <View style={styles.body}>
        {/* Weekday labels stay put while the grid scrolls */}
        <View style={[styles.labels, { paddingTop: MONTH_ROW }]}>
          {ROW_LABELS.map((label, i) => (
            <View key={i} style={styles.labelRow}>
              <Text style={styles.labelText}>{label}</Text>
            </View>
          ))}
        </View>

        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          // Start on the latest week, like GitHub does.
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
          contentContainerStyle={{ paddingRight: 2 }}
        >
          <View>
            <View style={{ height: MONTH_ROW, width: weeks.length * STEP }}>
              {months.map((m) => (
                <Text key={m.col} style={[styles.monthText, { left: m.col * STEP }]}>
                  {m.label}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {weeks.map((week, col) => (
                <Animated.View
                  key={week[0].key}
                  style={[
                    styles.column,
                    {
                      opacity: reveal.current[col],
                      transform: [
                        {
                          translateY: reveal.current[col].interpolate({
                            inputRange: [0, 1],
                            outputRange: [6, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  {week.map((day) => {
                    const isSelected = day.key === selected;
                    return (
                      <Pressable
                        key={day.key}
                        disabled={day.future}
                        onPress={() => setSelected(isSelected ? null : day.key)}
                        accessibilityLabel={`${formatDateKey(day.key)}, ${
                          day.count > 0 ? "checked in" : "no activity"
                        }`}
                        style={[
                          styles.cell,
                          { backgroundColor: day.future ? "transparent" : LEVEL_COLORS[day.level] },
                          day.key === today && styles.cellToday,
                          isSelected && styles.cellSelected,
                        ]}
                      />
                    );
                  })}
                </Animated.View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>

      <Text style={styles.detail} numberOfLines={1}>
        {detail}
      </Text>
      <View style={styles.footRow}>
        <View style={styles.legend}>
          <Text style={styles.legendText}>Less</Text>
          {LEVEL_COLORS.map((c, i) => (
            <View key={i} style={[styles.legendCell, { backgroundColor: c }]} />
          ))}
          <Text style={styles.legendText}>More</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same look as the other cards in the app.
  card: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: moderateScale(16),
    shadowColor: Colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  headRow: { marginBottom: moderateScale(12) },
  title: { color: Colors.textSecondary, fontSize: 13, fontWeight: "500" },
  titleStrong: { color: Colors.text, fontSize: 15, fontWeight: "800" },

  body: { flexDirection: "row" },
  labels: { width: LABEL_W },
  labelRow: { height: CELL, marginBottom: GAP, justifyContent: "center" },
  labelText: { color: Colors.textMuted, fontSize: 10, fontWeight: "600" },

  monthText: {
    position: "absolute",
    top: 0,
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: "600",
  },
  grid: { flexDirection: "row" },
  column: { marginRight: GAP },
  cell: { width: CELL, height: CELL, borderRadius: 3, marginBottom: GAP },
  cellToday: { borderWidth: 1.5, borderColor: Colors.primaryDark },
  cellSelected: { borderWidth: 1.5, borderColor: Colors.text },

  detail: {
    marginTop: moderateScale(12),
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "500",
  },
  footRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: moderateScale(8),
  },
  legend: { flexDirection: "row", alignItems: "center", gap: 3 },
  legendText: { color: Colors.textMuted, fontSize: 10, fontWeight: "600", marginHorizontal: 2 },
  legendCell: { width: 11, height: 11, borderRadius: 3 },
});
