import React from "react";
import { View, Text, StyleSheet } from "react-native";

import { Colors } from "../theme";
import { avatarPlaceholder } from "../utils/profileSetup";

/**
 * AvatarBadge — draws one avatar, by id (e.g. "female_3").
 *
 * PLACEHOLDER: for now an avatar is a coloured circle with a letter (see
 * avatarPlaceholder in utils/profileSetup.js). When the real avatar art is
 * ready, change ONLY the inside of this component to draw the image for
 * `avatarId`; every screen that shows an avatar goes through here.
 *
 * Props:
 *   avatarId   string | null — which avatar (null draws a neutral empty circle)
 *   size       diameter of the picture itself, default 56
 *   selected   draws a ring around it (used by the picker)
 *
 * The ring sits OUTSIDE `size`, in space that is always reserved, so selecting
 * an avatar never makes the grid jump.
 */
const RING = 3;
const GAP = 2;

export default function AvatarBadge({ avatarId, size = 56, selected = false }) {
  const { letter, color } = avatarId
    ? avatarPlaceholder(avatarId)
    : { letter: "", color: Colors.border };
  const outer = size + 2 * (RING + GAP);

  return (
    <View
      style={[
        styles.ring,
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderColor: selected ? Colors.primaryDark : "transparent",
        },
      ]}
    >
      <View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        ]}
      >
        {letter ? (
          <Text style={[styles.letter, { fontSize: Math.round(size * 0.42) }]}>{letter}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: RING,
    alignItems: "center",
    justifyContent: "center",
  },
  circle: {
    alignItems: "center",
    justifyContent: "center",
  },
  letter: {
    color: Colors.white,
    fontWeight: "800",
  },
});
