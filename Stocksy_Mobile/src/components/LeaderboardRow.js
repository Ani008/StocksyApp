import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import LeaderboardAvatar from "./LeaderboardAvatar";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const RANK_LEFT = moderateScale(6); // gap from the row's left edge to the number
const RANK_LETTER_SPACING = -3;
const MAX_RANK_SIZE = 86; // size used for single-digit ranks
const DIGIT_RATIO = 0.68; // how wide a black-weight digit is, relative to its font size (measured on web)
const AVATAR_LEFT = moderateScale(84); // where the avatar starts, the same in every row
// Space the number may use: from the row edge up to a small gap before the avatar.
const SLOT_WIDTH = AVATAR_LEFT - RANK_LEFT - moderateScale(8);

/**
 * One row of the leaderboard list (rank 4 and below).
 *
 * The rank is a huge, faded number sitting behind the row on the left and
 * cropped by the row's edges, with the avatar, name and points on top of it.
 *
 * Props:
 *   rank    the position number to show
 *   entry   { id, name, points, avatarId, avatarUrl, isSelf }
 *           your own row (isSelf) gets a blue outline and a "You" tag
 */
export default function LeaderboardRow({ rank, entry, style }) {
  // Every row has the same fixed slot for the number, so avatars, names and
  // points line up in a column. The number shrinks to fit the slot: 1 digit
  // stays at full size, 2 and 3 digits get smaller (never hidden or overlapped).
  const digits = String(rank).length;
  const fitted = (SLOT_WIDTH / digits - RANK_LETTER_SPACING) / DIGIT_RATIO;
  const numberSize = fontScale(Math.min(MAX_RANK_SIZE, fitted));

  return (
    <View
      style={[styles.row, entry.isSelf && styles.rowSelf, style]}
      accessibilityLabel={`Rank ${rank}, ${entry.name}${entry.isSelf ? " (you)" : ""}, ${entry.points} points`}
    >
      <Text
        style={[
          styles.rank,
          {
            fontSize: numberSize,
            lineHeight: numberSize * 1.1,
            bottom: -numberSize * 0.19,
          },
        ]}
        allowFontScaling={false}
      >
        {rank}
      </Text>

      <LeaderboardAvatar
        id={entry.id}
        name={entry.name}
        avatarId={entry.avatarId}
        avatarUrl={entry.avatarUrl}
        size={moderateScale(52)}
        borderColor={Colors.white}
        style={styles.avatar}
      />

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {entry.name}
          </Text>
          {entry.isSelf && (
            <View style={styles.youTag}>
              <Text style={styles.youText}>You</Text>
            </View>
          )}
        </View>
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
  // Your own row.
  rowSelf: {
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  // Giant faded number behind everything, pushed down a little so its bottom
  // is cut off by the row.
  rank: {
    position: "absolute",
    left: RANK_LEFT,
    fontWeight: "900",
    letterSpacing: RANK_LETTER_SPACING,
    color: "#E3E9F2",
  },
  avatar: {
    marginLeft: AVATAR_LEFT,
  },
  info: {
    flex: 1,
    marginLeft: moderateScale(14),
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
  },
  name: {
    flexShrink: 1,
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "800",
    color: Colors.text,
  },
  youTag: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 8,
    paddingHorizontal: moderateScale(7),
    paddingVertical: moderateScale(2),
  },
  youText: {
    fontSize: fontScale(Typography.small),
    fontWeight: "800",
    color: Colors.primaryDark,
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
