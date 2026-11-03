import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import LeaderboardAvatar from "./LeaderboardAvatar";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const RANK_LEFT = moderateScale(6); // gap from the row's left edge to the number
const RANK_LETTER_SPACING = -3;

/**
 * One row of the leaderboard list (rank 4 and below).
 *
 * The rank is a huge, faded number sitting behind the row on the left and
 * cropped by the row's edges, with the avatar, name and points on top of it.
 *
 * Props:
 *   rank    the position number to show
 *   entry   { id, name, points, avatarUrl }
 */
export default function LeaderboardRow({ rank, entry, style }) {
  // Size the number by how many digits it has, then push the avatar far enough
  // right that the whole number shows (nothing hides behind the avatar).
  // 3 digits get a smaller number so the name still has room.
  const digits = String(rank).length;
  const numberSize = fontScale(digits >= 3 ? 64 : 86);
  const digitWidth = numberSize * 0.6 + RANK_LETTER_SPACING;
  const avatarLeft = RANK_LEFT + digits * digitWidth + moderateScale(12);

  return (
    <View style={[styles.row, style]}>
      <Text
        style={[
          styles.rank,
          { fontSize: numberSize, lineHeight: numberSize * 1.1 },
        ]}
        allowFontScaling={false}
      >
        {rank}
      </Text>

      <LeaderboardAvatar
        id={entry.id}
        name={entry.name}
        avatarUrl={entry.avatarUrl}
        size={moderateScale(52)}
        borderColor={Colors.white}
        style={{ marginLeft: avatarLeft }}
      />

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {entry.name}
        </Text>
        <View style={styles.pointsRow}>
          <Ionicons name="star" size={moderateScale(14)} color={Colors.warning} />
          <Text style={styles.points}>{entry.points}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.white,
    borderRadius: 20,
    height: moderateScale(78),
    paddingRight: moderateScale(16),
    marginBottom: moderateScale(12),
    // Crops the oversized rank number at the row's edges.
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  // Giant faded number behind everything, pushed down a little so its bottom
  // is cut off by the row.
  rank: {
    position: "absolute",
    left: RANK_LEFT,
    bottom: -moderateScale(16),
    fontWeight: "900",
    letterSpacing: RANK_LETTER_SPACING,
    color: "#E3E9F2",
  },
  info: {
    flex: 1,
    marginLeft: moderateScale(14),
  },
  name: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "800",
    color: Colors.text,
  },
  pointsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(5),
    marginTop: moderateScale(3),
  },
  points: {
    fontSize: fontScale(Typography.body),
    fontWeight: "700",
    color: Colors.textSecondary,
  },
});
