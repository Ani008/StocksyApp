import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Modal from "./AppModal";
import Button from "./Button";
import SegmentedToggle from "./SegmentedToggle";
import UsernameField from "./UsernameField";
import AvatarBadge from "./AvatarBadge";
import useUsernameCheck from "../hooks/useUsernameCheck";
import { getAvatars, updateMyProfile } from "../../services/profileService";
import { showToast } from "../../services/uiBridge";
import {
  AVATAR_GENDERS,
  apiErrorCode,
  apiErrorMessage,
  genderOfAvatar,
  getSetupNeeds,
  groupAvatarsByGender,
  normalizeUsername,
} from "../utils/profileSetup";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const TABS = [
  { key: "username", label: "Username" },
  { key: "avatar", label: "Avatar" },
];

const GENDER_TABS = [
  { key: "male", label: "Male" },
  { key: "female", label: "Female" },
];

const SUBTITLE = {
  username: "Pick a unique username so friends can find you.",
  avatar: "Choose an avatar. You can change it any time.",
};

/**
 * ProfileSetupModal — one small box that sets up the two things a new profile
 * needs, behind a Username | Avatar capsule.
 *
 * Opens on whichever is still missing (username first). Save stores whatever
 * the person has typed / picked; if the other half is still missing the box
 * moves over to it, otherwise it closes. The cross closes it without saving —
 * nothing here is mandatory.
 *
 * Props:
 *   visible
 *   profile   { username, avatarId } — null where not chosen yet
 *   onSaved   (nextProfile: { username, avatarId }) => void   after a successful save
 *   onClose   () => void                                      the cross / Android back
 */
export default function ProfileSetupModal({ visible, profile, onSaved, onClose }) {
  const needs = getSetupNeeds(profile);

  const [tab, setTab] = useState(needs.firstTab);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState(profile?.avatarId ?? null);
  const [gender, setGender] = useState(genderOfAvatar(profile?.avatarId) || "female");
  const [saving, setSaving] = useState(false);

  const [avatars, setAvatars] = useState([]);
  const [avatarsState, setAvatarsState] = useState("idle"); // idle | loading | ready | error

  // Only check names while there is a username to choose.
  const usernameCheck = useUsernameCheck(needs.needsUsername ? usernameDraft : "");

  // Every time the box opens: start from the current profile.
  useEffect(() => {
    if (!visible) return;
    const now = getSetupNeeds(profile);
    setTab(now.firstTab);
    setUsernameDraft("");
    setSelectedAvatar(profile?.avatarId ?? null);
    setGender(genderOfAvatar(profile?.avatarId) || "female");
    setSaving(false);
    // Opening is the trigger; `profile` is read once, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const loadAvatars = async () => {
    setAvatarsState("loading");
    try {
      setAvatars(await getAvatars());
      setAvatarsState("ready");
    } catch {
      setAvatarsState("error");
    }
  };

  // Fetch the list once, when the box is first opened.
  useEffect(() => {
    if (visible && avatarsState === "idle") loadAvatars();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const groups = useMemo(() => groupAvatarsByGender(avatars), [avatars]);

  const typedUsername = needs.needsUsername ? normalizeUsername(usernameDraft) : "";
  const pendingAvatar =
    selectedAvatar && selectedAvatar !== (profile?.avatarId ?? null) ? selectedAvatar : null;

  // A typed username that is known to be unusable blocks Save until it is
  // fixed or cleared, rather than quietly saving only the avatar.
  const usernameBlocked =
    !!typedUsername && ["taken", "invalid", "error"].includes(usernameCheck.status);
  const canSave = !saving && !usernameBlocked && (!!typedUsername || !!pendingAvatar);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const changes = {};

      if (typedUsername) {
        const ok = await usernameCheck.ensureChecked();
        if (!ok) {
          setTab("username"); // the reason is already showing under the field
          return;
        }
        changes.username = typedUsername;
      }
      if (pendingAvatar) changes.avatarId = pendingAvatar;

      const account = await updateMyProfile(changes);

      // Same shape GET /users/me gives: username is null until chosen.
      const next = {
        username: account.usernameSet ? account.username : null,
        avatarId: account.avatarId ?? null,
      };
      showToast("Profile updated", "success");

      const stillNeeds = getSetupNeeds(next);
      if (stillNeeds.needsAny) {
        setTab(stillNeeds.firstTab); // carry on with the half that is left
        setUsernameDraft("");
      }
      onSaved(next);
    } catch (err) {
      if (apiErrorCode(err) === "USERNAME_TAKEN") {
        usernameCheck.markTaken();
        setTab("username");
      } else {
        showToast(apiErrorMessage(err, "Couldn't save your profile. Please try again."), "error");
      }
    } finally {
      setSaving(false);
    }
  };

  const renderUsernameTab = () => {
    if (!needs.needsUsername) {
      return (
        <View style={styles.doneBox}>
          <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
          <Text style={styles.doneText}>
            Your username is <Text style={styles.doneHandle}>@{profile.username}</Text>
          </Text>
        </View>
      );
    }
    return (
      <UsernameField
        value={usernameDraft}
        onChangeText={setUsernameDraft}
        status={usernameCheck.status}
        message={usernameCheck.message}
        autoFocus
      />
    );
  };

  const renderAvatarTab = () => {
    if (avatarsState === "loading" || avatarsState === "idle") {
      return (
        <View style={styles.avatarMessage}>
          <ActivityIndicator color={Colors.primaryDark} />
        </View>
      );
    }
    if (avatarsState === "error") {
      return (
        <View style={styles.avatarMessage}>
          <Text style={styles.errorText}>Couldn't load avatars.</Text>
          <TouchableOpacity onPress={loadAvatars} activeOpacity={0.7}>
            <Text style={styles.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const ids = groups[gender] || [];
    return (
      <View>
        <SegmentedToggle
          options={GENDER_TABS.filter((g) => AVATAR_GENDERS.includes(g.key))}
          value={gender}
          onChange={setGender}
          theme="neutral"
          style={styles.genderToggle}
        />
        <View style={styles.grid}>
          {ids.map((id) => (
            <TouchableOpacity
              key={id}
              onPress={() => setSelectedAvatar(id)}
              activeOpacity={0.8}
              style={styles.gridItem}
              accessibilityRole="button"
              accessibilityLabel={`Avatar ${id.replace("_", " ")}`}
              aria-selected={selectedAvatar === id}
            >
              <AvatarBadge avatarId={id} size={56} selected={selectedAvatar === id} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.overlay}>
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Set up your profile</Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.subtitle}>{SUBTITLE[tab]}</Text>

            <SegmentedToggle
              options={TABS}
              value={tab}
              onChange={setTab}
              theme="neutral"
              style={styles.tabToggle}
            />

            <View style={styles.body}>
              {tab === "username" ? renderUsernameTab() : renderAvatarTab()}
            </View>

            <Button title="Save" onPress={handleSave} disabled={!canSave} loading={saving} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: moderateScale(24),
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: moderateScale(24),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: moderateScale(6),
  },
  title: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
  },
  subtitle: {
    fontSize: fontScale(13.5),
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: moderateScale(16),
  },
  tabToggle: { alignSelf: "center", marginBottom: moderateScale(18) },
  // Same height on both tabs so switching doesn't resize the card.
  body: { minHeight: moderateScale(170), marginBottom: moderateScale(8) },

  doneBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.successBg,
    borderRadius: 12,
    padding: moderateScale(14),
  },
  doneText: { marginLeft: moderateScale(10), flex: 1, fontSize: fontScale(14), color: Colors.text },
  doneHandle: { fontWeight: "700" },

  genderToggle: { alignSelf: "center", marginBottom: moderateScale(14) },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  gridItem: { margin: moderateScale(4) },
  avatarMessage: { minHeight: moderateScale(150), alignItems: "center", justifyContent: "center" },
  errorText: { color: Colors.danger, fontSize: fontScale(14), fontWeight: "500", marginBottom: moderateScale(8) },
  retry: { color: Colors.primaryDark, fontSize: fontScale(14), fontWeight: "700" },
});
