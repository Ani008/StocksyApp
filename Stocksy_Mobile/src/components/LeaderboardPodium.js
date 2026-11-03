import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import LeaderboardAvatar from "./LeaderboardAvatar";
import LeaderboardPillar from "./LeaderboardPillar";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

// Per-rank look. Pillar height is what makes 1st stand tallest; `side` is which
// side face the 3D pillar shows (the outer two lean away from the middle).
const PLACES = {
  1: { height: 160, avatar: 64, side: "none" },
  2: { height: 126, avatar: 54, side: "left" },
  3: { height: 100, avatar: 54, side: "right" },
};

function Place({ rank, entry }) {
  const look = PLACES[rank];

  return (
    <View style={styles.column}>
      {entry ? (
        <>
          <LeaderboardAvatar
            id={entry.id}
            name={entry.name}
            avatarUrl={entry.avatarUrl}
            size={moderateScale(look.avatar)}
            borderColor={Colors.white}
          />

          <Text style={styles.name} numberOfLines={1}>
            {entry.name}
          </Text>
          <View style={styles.pointsRow}>
            <Ionicons name="star" size={moderateScale(12)} color={Colors.warning} />
            <Text style={styles.points}>{entry.points}</Text>
          </View>
        </>
      ) : (
        // Fewer than 3 users: keep the column so the pillars stay in place.
        <View style={{ height: moderateScale(look.avatar) }} />
      )}

      <LeaderboardPillar rank={rank} height={look.height} side={look.side} />
    </View>
  );
}

/**
 * The top-3 podium: 2nd on the left, 1st in the middle, 3rd on the right.
 *
 * Props:
 *   entries  the top users in rank order ([1st, 2nd, 3rd]), see leaderboardMock
 */
export default function LeaderboardPodium({ entries = [], style }) {
  const [first, second, third] = entries;

  return (
    <View style={[styles.row, style]}>
      <Place rank={2} entry={second} />
      <Place rank={1} entry={first} />
      <Place rank={3} entry={third} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: moderateScale(20),
  },
  column: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: moderateScale(4),
  },
  name: {
    marginTop: moderateScale(6),
    maxWidth: "100%",
    fontSize: fontScale(Typography.caption),
    fontWeight: "700",
    color: Colors.text,
  },
  pointsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(3),
    marginTop: moderateScale(2),
    marginBottom: moderateScale(8),
  },
  points: {
    fontSize: fontScale(Typography.small),
    fontWeight: "700",
    color: Colors.textSecondary,
  },
});
