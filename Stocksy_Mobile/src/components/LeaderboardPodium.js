import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import LeaderboardAvatar from "./LeaderboardAvatar";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

// Per-rank look. Pillar height is what makes 1st stand tallest.
const PLACES = {
  1: {
    height: 150,
    avatar: 64,
    colors: [Colors.primaryAccent, Colors.primaryDark],
    badge: "#F5B301", // gold
  },
  2: {
    height: 112,
    avatar: 54,
    colors: ["#93C5FD", Colors.primary],
    badge: "#A8B0BC", // silver
  },
  3: {
    height: 88,
    avatar: 54,
    colors: ["#BFDBFE", Colors.primaryAccent],
    badge: "#CD7F32", // bronze
  },
};

function Place({ rank, entry }) {
  const look = PLACES[rank];

  return (
    <View style={styles.column}>
      {entry ? (
        <>
          <View>
            <LeaderboardAvatar
              id={entry.id}
              name={entry.name}
              avatarUrl={entry.avatarUrl}
              size={moderateScale(look.avatar)}
              borderColor={look.badge}
            />
            <View style={[styles.badge, { backgroundColor: look.badge }]}>
              <Text style={styles.badgeText}>{rank}</Text>
            </View>
          </View>

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

      <LinearGradient
        colors={look.colors}
        style={[styles.pillar, { height: moderateScale(look.height) }]}
      >
        <Text style={styles.pillarRank}>{rank}</Text>
      </LinearGradient>
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
  badge: {
    position: "absolute",
    top: -moderateScale(2),
    right: -moderateScale(2),
    width: moderateScale(20),
    height: moderateScale(20),
    borderRadius: moderateScale(10),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: Colors.white,
  },
  badgeText: {
    color: Colors.white,
    fontSize: fontScale(Typography.tiny),
    fontWeight: "800",
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
  pillar: {
    width: "100%",
    alignItems: "center",
    paddingTop: moderateScale(10),
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  pillarRank: {
    fontSize: fontScale(34),
    fontWeight: "900",
    color: "rgba(255,255,255,0.85)",
  },
});
