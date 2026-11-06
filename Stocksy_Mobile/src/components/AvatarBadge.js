import React from "react";
import { View, Text, StyleSheet } from "react-native";

import { Colors } from "../theme";

// Male avatars
import Male1 from "../../assets/avatars/male/male_1.svg";
import Male2 from "../../assets/avatars/male/male_2.svg";
import Male3 from "../../assets/avatars/male/male_3.svg";
import Male4 from "../../assets/avatars/male/male_4.svg";
import Male5 from "../../assets/avatars/male/male_5.svg";
import Male6 from "../../assets/avatars/male/male_6.svg";
import Male7 from "../../assets/avatars/male/male_7.svg";
import Male8 from "../../assets/avatars/male/male_8.svg";

// Female avatars
import Female1 from "../../assets/avatars/female/female_1.svg";
import Female2 from "../../assets/avatars/female/female_2.svg";
import Female3 from "../../assets/avatars/female/female_3.svg";
import Female4 from "../../assets/avatars/female/female_4.svg";
import Female5 from "../../assets/avatars/female/female_5.svg";
import Female6 from "../../assets/avatars/female/female_6.svg";
import Female7 from "../../assets/avatars/female/female_7.svg";
import Female8 from "../../assets/avatars/female/female_8.svg";

// Central avatar mapping
export const AVATAR_COMPONENTS = {
  male_1: Male1,
  male_2: Male2,
  male_3: Male3,
  male_4: Male4,
  male_5: Male5,
  male_6: Male6,
  male_7: Male7,
  male_8: Male8,

  female_1: Female1,
  female_2: Female2,
  female_3: Female3,
  female_4: Female4,
  female_5: Female5,
  female_6: Female6,
  female_7: Female7,
  female_8: Female8,
};

const RING = 3;
const GAP = 2;

export default function AvatarBadge({
  avatarId,
  size = 56,
  selected = false,
}) {
  const AvatarComponent = AVATAR_COMPONENTS[avatarId];

  const outer = size + 2 * (RING + GAP);

  return (
    <View
      style={[
        styles.ring,
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderColor: selected
            ? Colors.primaryDark
            : "transparent",
        },
      ]}
    >
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
      >
        {AvatarComponent ? (
          <AvatarComponent
            width={size}
            height={size}
          />
        ) : (
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>
              {avatarId ? avatarId[0].toUpperCase() : ""}
            </Text>
          </View>
        )}
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
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.border,
  },

  fallback: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },

  fallbackText: {
    color: Colors.white,
    fontWeight: "800",
    fontSize: 22,
  },
});