import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import CountUpText from "./CountUpText";
import LeaderboardAvatar from "./LeaderboardAvatar";
import LeaderboardGlow from "./LeaderboardGlow";
import LeaderboardPillar from "./LeaderboardPillar";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

// Per-rank look. Pillar height is what makes 1st stand tallest; `side` is which
// side face the 3D pillar shows (the outer two lean away from the middle).
const PLACES = {
  1: { height: 160, avatar: 64, side: "none" },
  2: { height: 126, avatar: 54, side: "left" },
  3: { height: 100, avatar: 54, side: "right" },
};

// Entrance animation: each column (pillar plus the person standing on it) slides
// up from the bottom edge of the podium. 3rd rises first, then 2nd, then 1st
// last, so the winner gets the big finish.
const RISE_DURATION = 850;
const RISE_DELAY = { 3: 0, 2: 220, 1: 440 };

// When a column is about to land (a bit before it finishes rising): its points
// start counting up and, for 1st, the glow fades in.
const landDelay = (rank) => RISE_DELAY[rank] + RISE_DURATION * 0.55;
const COUNT_DURATION = 1000;

// Glow behind 1st place. The podium gets some headroom so the glow isn't cut off
// or pushed over the toggle above.
const GLOW_SIZE = moderateScale(210);
const TOP_HEADROOM = moderateScale(20);

function Place({ rank, entry }) {
  const look = PLACES[rank];

  // 0 = still below the podium, 1 = standing in place.
  const progress = useRef(new Animated.Value(0)).current;
  // Height of the column, measured so it starts exactly out of view.
  const [contentHeight, setContentHeight] = useState(0);

  // Start once the height is known (a rise from an unknown height would jump).
  useEffect(() => {
    if (!contentHeight) return undefined;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: RISE_DURATION,
      delay: RISE_DELAY[rank],
      easing: Easing.bezier(0.22, 1, 0.36, 1), // quick start, soft landing
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [contentHeight, progress, rank]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [contentHeight, 0],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.25, 1],
    outputRange: [0, 1, 1],
  });

  return (
    <View style={styles.column}>
      {/* Clips the column at the podium's bottom edge while it rises, so it
          looks like it comes up out of the floor instead of sliding over the list. */}
      <View style={styles.clip}>
        <Animated.View
          style={[styles.rise, { opacity, transform: [{ translateY }] }]}
          onLayout={(e) => setContentHeight(e.nativeEvent.layout.height)}
        >
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
                <CountUpText
                  value={entry.points}
                  delay={landDelay(rank)}
                  duration={COUNT_DURATION}
                  style={styles.points}
                />
              </View>
            </>
          ) : (
            // Fewer than 3 users: keep the column so the pillars stay in place.
            <View style={{ height: moderateScale(look.avatar) }} />
          )}

          <LeaderboardPillar rank={rank} height={look.height} side={look.side} />
        </Animated.View>
      </View>
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
      {/* Drawn first so it sits behind everything. 1st is the tallest column, so
          its avatar is at the top of the row: centre the glow on it. */}
      {first && (
        <LeaderboardGlow
          size={GLOW_SIZE}
          delay={landDelay(1)}
          style={{
            position: "absolute",
            left: "50%",
            marginLeft: -GLOW_SIZE / 2,
            top: TOP_HEADROOM + moderateScale(PLACES[1].avatar) / 2 - GLOW_SIZE / 2,
          }}
        />
      )}

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
    paddingTop: TOP_HEADROOM,
  },
  column: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: moderateScale(4),
  },
  clip: {
    width: "100%",
    overflow: "hidden",
  },
  rise: {
    width: "100%",
    alignItems: "center",
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
