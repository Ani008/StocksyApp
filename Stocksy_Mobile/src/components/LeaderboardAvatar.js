import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { AVATAR_COMPONENTS } from "./AvatarBadge";
import FounderAniket from "../../assets/avatars/founder/founder_aniket.svg";
import { Colors, fontScale } from "../theme";

const FOUNDER_AVATAR_ID = "founder_aniket";

// Soft background colours for the placeholder circles. Picked from the user id
// so the same person always gets the same colour.
const PLACEHOLDER_COLORS = [
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#10B981",
  "#06B6D4",
  "#EF4444",
  "#6366F1",
];

const colorFor = (id = "") => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PLACEHOLDER_COLORS[Math.abs(hash) % PLACEHOLDER_COLORS.length];
};

/**
 * Round avatar for a leaderboard user.
 *
 * Shows, in this order: the avatar the person picked (`avatarId`, same pictures
 * as the Profile and the follow lists), their Google photo (`avatarUrl`), or a
 * coloured circle with the user's first letter.
 */
export default function LeaderboardAvatar({
  id,
  name,
  avatarId,
  avatarUrl,
  size = 48,
  borderColor = Colors.white,
  style,
}) {
  const circle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderColor,
  };

  const Picked = avatarId === FOUNDER_AVATAR_ID ? FounderAniket : AVATAR_COMPONENTS[avatarId];

  return (
    <View style={[styles.circle, circle, style]}>
      {Picked ? (
        <Picked width="100%" height="100%" />
      ) : avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.image} />
      ) : (
        <View style={[styles.fallback, { backgroundColor: colorFor(id) }]}>
          <Text style={[styles.initial, { fontSize: fontScale(size * 0.4) }]}>
            {(name || "?").trim().charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderWidth: 2,
    overflow: "hidden",
    backgroundColor: Colors.white,
  },
  image: { width: "100%", height: "100%" },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    color: Colors.white,
    fontWeight: "800",
  },
});
