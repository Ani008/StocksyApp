import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

import { Colors, Typography, fontScale, moderateScale } from "../theme";

/**
 * FilterTabs — full-width tab bar with a live count per tab, for splitting a
 * long list by status (Alerts: Active / Triggered / Cancelled, Orders:
 * Open / Filled / Cancelled). Same look as SegmentedToggle's "neutral" theme,
 * but the tabs share the row equally so 3 labels + counts fit on a phone.
 *
 * Props:
 *   options   Array<{ key: string, label: string, count?: number }>
 *   value     string — selected option's `key`
 *   onChange  (key: string) => void
 *   style     extra container style overrides
 */
export default function FilterTabs({ options, value, onChange, style }) {
  return (
    <View style={[styles.track, style]} accessibilityRole="tablist">
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <TouchableOpacity
            key={opt.key}
            style={[styles.tab, active && styles.tabActive]}
            activeOpacity={0.8}
            onPress={() => onChange(opt.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.text, active && styles.textActive]} numberOfLines={1}>
              {opt.label}
              {opt.count != null && (
                <Text style={[styles.count, active && styles.countActive]}>
                  {"  "}
                  {opt.count}
                </Text>
              )}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: Colors.divider,
    borderRadius: 20,
    padding: moderateScale(3),
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: moderateScale(8),
    borderRadius: 17,
  },
  tabActive: {
    backgroundColor: Colors.white,
  },
  text: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  textActive: {
    color: Colors.primaryDark,
  },
  count: {
    fontSize: fontScale(11),
    fontWeight: "600",
    color: Colors.textMuted,
  },
  countActive: {
    color: Colors.primary,
  },
});
