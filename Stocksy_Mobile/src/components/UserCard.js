import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import AvatarBadge from "./AvatarBadge";
import { followButtonState, primaryName, secondaryName } from "../utils/followUsers";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const AVATAR_SIZE = moderateScale(48);

/**
 * One person in the Followers / Following lists and in people search:
 *
 *   ( avatar )  username                    [ Follow ]
 *               Full Name
 *
 * The username is the big line; the full name sits under it in small letters
 * (left out when it adds nothing). The button is hidden on your own card.
 *
 * Props:
 *   user      { id, fullName, username, avatarId, isSelf, isFollowing, followsYou }
 *   busy      true while this person's follow / unfollow request is running
 *   onToggle  called with `user` when the button is tapped
 */
export default function UserCard({ user, busy = false, onToggle, style }) {
  const name = primaryName(user);
  const subtitle = secondaryName(user);
  const button = followButtonState(user);

  return (
    <View style={[styles.card, style]}>
      <AvatarBadge avatarId={user.avatarId} size={AVATAR_SIZE} />

      <View style={styles.info}>
        <Text style={styles.username} numberOfLines={1}>
          {name}
        </Text>
        {!!subtitle && (
          <Text style={styles.fullName} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>

      {button && (
        <TouchableOpacity
          style={[styles.button, button.filled ? styles.buttonFilled : styles.buttonOutline]}
          activeOpacity={0.8}
          disabled={busy}
          onPress={() => onToggle?.(user)}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy }}
          accessibilityLabel={`${button.label} ${name}`}
        >
          {busy ? (
            <ActivityIndicator size="small" color={button.filled ? Colors.white : Colors.textSecondary} />
          ) : (
            <Text style={[styles.buttonText, button.filled ? styles.textFilled : styles.textOutline]}>
              {button.label}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.divider,
    paddingVertical: moderateScale(10),
    paddingLeft: moderateScale(12),
    paddingRight: moderateScale(14),
    marginBottom: moderateScale(12),
  },
  info: {
    flex: 1,
    marginLeft: moderateScale(10),
    marginRight: moderateScale(10),
  },
  username: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "800",
    color: Colors.text,
  },
  fullName: {
    marginTop: moderateScale(2),
    fontSize: fontScale(Typography.small),
    fontWeight: "500",
    color: Colors.textSecondary,
  },
  // Fixed width so "Follow", "Following" and "Follow back" all give the same
  // button, and the spinner doesn't make it jump.
  button: {
    width: moderateScale(104),
    height: moderateScale(36),
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonFilled: { backgroundColor: Colors.primaryDark },
  buttonOutline: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  buttonText: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "700",
  },
  textFilled: { color: Colors.white },
  textOutline: { color: Colors.text },
});
