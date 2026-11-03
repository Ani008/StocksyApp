import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import LeaderboardAvatar from "./LeaderboardAvatar";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

/**
 * One row of the leaderboard list (rank 4 and below).
 *
 * Props:
 *   rank    the position number to show
 *   entry   { id, name, points, avatarUrl }
 */
export default function LeaderboardRow({ rank, entry, style }) {
  return (
    <View style={[styles.row, style]}>
      <Text style={styles.rank}>{rank}</Text>

      <LeaderboardAvatar
        id={entry.id}
        name={entry.name}
        avatarUrl={entry.avatarUrl}
        size={moderateScale(44)}
        borderColor={Colors.border}
      />

      <Text style={styles.name} numberOfLines={1}>
        {entry.name}
      </Text>

      <View style={styles.pointsRow}>
        <Ionicons name="star" size={moderateScale(14)} color={Colors.warning} />
        <Text style={styles.points}>{entry.points}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingVertical: moderateScale(10),
    paddingHorizontal: moderateScale(14),
    marginBottom: moderateScale(10),
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  rank: {
    width: moderateScale(28),
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "800",
    color: Colors.textMuted,
  },
  name: {
    flex: 1,
    marginLeft: moderateScale(12),
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
  },
  pointsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(4),
    marginLeft: moderateScale(8),
  },
  points: {
    fontSize: fontScale(Typography.body),
    fontWeight: "700",
    color: Colors.textSecondary,
  },
});
