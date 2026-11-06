import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import AppTextInput from "../components/AppTextInput";
import AvatarBadge from "../components/AvatarBadge";
import Button from "../components/Button";
import SegmentedToggle from "../components/SegmentedToggle";
import { getAvatars, getMyProfile, updateMyProfile } from "../../services/profileService";
import { showToast } from "../../services/uiBridge";
import { cleanFullName, fullNameError, profileChanges, MAX_FULL_NAME_LENGTH } from "../utils/editProfile";
import {
  AVATAR_GENDERS,
  apiErrorMessage,
  genderOfAvatar,
  groupAvatarsByGender,
} from "../utils/profileSetup";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const GENDER_TABS = [
  { key: "male", label: "Male" },
  { key: "female", label: "Female" },
];

/**
 * Edit Profile (opened by the pencil on the Profile avatar).
 *
 * Editable: full name and avatar.
 * Locked (shown, greyed, with a lock): username and email — they identify the
 * account, so this page never sends them.
 *
 * Starts from what is stored on the phone, then refreshes from the server so
 * the form is never behind. Save sends only what changed; the stored user is
 * updated by updateMyProfile, so Profile and Dashboard pick it up on return.
 */
const EditProfilePage = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [original, setOriginal] = useState({ fullName: "", avatarId: null });
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");

  const [fullName, setFullName] = useState("");
  const [avatarId, setAvatarId] = useState(null);
  const [gender, setGender] = useState("female");
  const [touchedName, setTouchedName] = useState(false);
  const [saving, setSaving] = useState(false);

  const [avatars, setAvatars] = useState([]);
  const [avatarsState, setAvatarsState] = useState("loading"); // loading | ready | error

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("MainTabs");
  };

  // Prefill: stored copy first (instant, has the email), then the server.
  useEffect(() => {
    let alive = true;

    (async () => {
      let base = { fullName: "", avatarId: null };
      try {
        const raw = await AsyncStorage.getItem("user");
        if (raw) {
          const stored = JSON.parse(raw);
          base = { fullName: stored.fullName || "", avatarId: stored.avatarId ?? null };
          if (alive) {
            setEmail(stored.email || "");
            setUsername(stored.usernameSet ? stored.username || "" : "");
          }
        }
      } catch {
        /* the server answer below still fills the form */
      }

      try {
        const me = await getMyProfile();
        base = { fullName: me.fullName || base.fullName, avatarId: me.avatarId ?? base.avatarId };
        if (alive) setUsername(me.username || "");
      } catch {
        /* offline: the stored copy stays */
      }

      if (!alive) return;
      setOriginal(base);
      setFullName(base.fullName);
      setAvatarId(base.avatarId);
      setGender(genderOfAvatar(base.avatarId) || "female");
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, []);

  const loadAvatars = async () => {
    setAvatarsState("loading");
    try {
      setAvatars(await getAvatars());
      setAvatarsState("ready");
    } catch {
      setAvatarsState("error");
    }
  };

  useEffect(() => {
    loadAvatars();
  }, []);

  const groups = useMemo(() => groupAvatarsByGender(avatars), [avatars]);

  const nameError = touchedName ? fullNameError(fullName) : "";
  const changes = profileChanges(original, { fullName, avatarId });
  const hasChanges = Object.keys(changes).length > 0;
  const canSave = !loading && !saving && hasChanges && !fullNameError(fullName);

  const handleSave = async () => {
    setTouchedName(true);
    if (!canSave) return;

    setSaving(true);
    try {
      await updateMyProfile(changes);
      showToast("Profile updated", "success");
      goBack();
    } catch (err) {
      showToast(apiErrorMessage(err, "Couldn't save your profile. Please try again."), "error");
    } finally {
      setSaving(false);
    }
  };

  const renderAvatarPicker = () => {
    if (avatarsState === "loading") {
      return (
        <View style={styles.pickerMessage}>
          <ActivityIndicator color={Colors.primaryDark} />
        </View>
      );
    }
    if (avatarsState === "error") {
      return (
        <View style={styles.pickerMessage}>
          <Text style={styles.errorText}>Couldn't load avatars.</Text>
          <TouchableOpacity onPress={loadAvatars} activeOpacity={0.7}>
            <Text style={styles.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

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
          {(groups[gender] || []).map((id) => (
            <TouchableOpacity
              key={id}
              onPress={() => setAvatarId(id)}
              activeOpacity={0.8}
              style={styles.gridItem}
              accessibilityRole="button"
              accessibilityLabel={`Avatar ${id.replace("_", " ")}`}
              aria-selected={avatarId === id}
            >
              <AvatarBadge avatarId={id} size={moderateScale(56)} selected={avatarId === id} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  // A greyed, non-editable row: the label, the value and a lock.
  const renderLockedRow = (label, value, placeholder) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputBox, styles.lockedBox]}>
        <Text style={[styles.lockedText, !value && styles.lockedPlaceholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Ionicons name="lock-closed" size={moderateScale(16)} color={Colors.textMuted} />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.headerBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={moderateScale(20)} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit profile</Text>
        <View style={styles.headerBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primaryDark} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.avatarPreview}>
              <AvatarBadge avatarId={avatarId} size={moderateScale(96)} />
              <Text style={styles.avatarHint}>Choose an avatar</Text>
            </View>

            <View style={styles.card}>{renderAvatarPicker()}</View>

            <View style={styles.field}>
              <Text style={styles.label}>Full name</Text>
              <View style={[styles.inputBox, !!nameError && styles.inputError]}>
                <AppTextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={setFullName}
                  onBlur={() => setTouchedName(true)}
                  placeholder="Your name"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="words"
                  autoCorrect={false}
                  maxLength={MAX_FULL_NAME_LENGTH}
                  returnKeyType="done"
                  accessibilityLabel="Full name"
                />
              </View>
              {!!nameError && <Text style={styles.errorText}>{nameError}</Text>}
            </View>

            {renderLockedRow("Username", username ? `@${username}` : "", "Not set yet")}
            {renderLockedRow("Email", email, "—")}
            <Text style={styles.lockNote}>Your username and email can't be changed.</Text>

            <Button
              title="Save changes"
              onPress={handleSave}
              disabled={!canSave}
              loading={saving}
              style={styles.saveBtn}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: moderateScale(20),
    paddingVertical: moderateScale(14),
  },
  headerBtn: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: moderateScale(18),
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
  },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: {
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(40),
  },
  avatarPreview: { alignItems: "center", marginBottom: moderateScale(16) },
  avatarHint: {
    marginTop: moderateScale(8),
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.divider,
    padding: moderateScale(14),
    marginBottom: moderateScale(20),
  },
  genderToggle: { alignSelf: "center", marginBottom: moderateScale(12) },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  gridItem: { margin: moderateScale(4) },
  pickerMessage: {
    minHeight: moderateScale(120),
    alignItems: "center",
    justifyContent: "center",
  },
  field: { marginBottom: moderateScale(16) },
  label: {
    fontSize: fontScale(Typography.small),
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: moderateScale(6),
  },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    height: moderateScale(48),
    paddingHorizontal: moderateScale(14),
    borderRadius: 14,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputError: { borderColor: Colors.danger },
  input: {
    flex: 1,
    paddingVertical: 0,
    fontSize: fontScale(Typography.body),
    color: Colors.text,
  },
  lockedBox: { backgroundColor: Colors.background, justifyContent: "space-between" },
  lockedText: {
    flex: 1,
    marginRight: moderateScale(8),
    fontSize: fontScale(Typography.body),
    color: Colors.textSecondary,
  },
  lockedPlaceholder: { color: Colors.textMuted },
  lockNote: {
    fontSize: fontScale(Typography.small),
    color: Colors.textMuted,
    marginBottom: moderateScale(24),
  },
  errorText: {
    marginTop: moderateScale(6),
    fontSize: fontScale(Typography.small),
    fontWeight: "500",
    color: Colors.danger,
  },
  retry: { marginTop: moderateScale(6), color: Colors.primaryDark, fontWeight: "700" },
  saveBtn: { marginTop: moderateScale(4) },
});

export default EditProfilePage;
