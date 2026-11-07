import React, { useEffect, useState } from "react";
import { ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { CompetitionScene, useReduceMotion } from "../components/VuCompetitionCard";
import { getMyProfile } from "../../services/profileService";
import { showToast } from "../../services/uiBridge";
import { DIVISIONS, OVERVIEW, RULES, VU } from "../constants/vuCompetition";
import { Colors, Shadows, fontScale, moderateScale } from "../theme";

/**
 * VU Trading Competition page (opened from the card on Daily Challenge).
 *
 * Frontend only for now (stage 2):
 *   - the student's name, username and email are filled in from the account
 *     (locked: they identify the account, so this page never edits them)
 *   - a Division dropdown, A to G
 *   - the competition overview and rules
 * Joining is not wired to a server yet (stage 3), so "Join competition" only
 * checks that a division is picked and then tells the person it is coming.
 */
const VuCompetitionPage = ({ navigation }) => {
  const reduceMotion = useReduceMotion();

  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");

  const [division, setDivision] = useState(null); // a DIVISIONS key, or null
  const [open, setOpen] = useState(false);
  const [triedJoin, setTriedJoin] = useState(false);

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("MainTabs");
  };

  // Autofill: the copy stored on the phone first (instant), then the server.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("user");
        if (raw && alive) {
          const stored = JSON.parse(raw);
          setFullName(stored.fullName || "");
          setEmail(stored.email || "");
          setUsername(stored.usernameSet ? stored.username || "" : "");
        }
      } catch {
        /* the server answer below still fills the form */
      }
      try {
        const me = await getMyProfile();
        if (alive) {
          if (me.fullName) setFullName(me.fullName);
          if (me.username) setUsername(me.username);
        }
      } catch {
        /* offline: the stored copy stays */
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const selected = DIVISIONS.find((d) => d.key === division);
  const divisionError = triedJoin && !division;

  const handleJoin = () => {
    setTriedJoin(true);
    if (!division) {
      showToast("Please select your division first", "warning");
      return;
    }
    // Stage 3 will create the entry and the contest wallet on the server.
    showToast("Joining isn't live yet. Coming soon!", "warning");
  };

  const lockedRow = (label, value, placeholder) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, styles.lockedBox]}>
        <Text style={[styles.lockedText, !value && styles.placeholder]} numberOfLines={1}>
          {value || (loading ? "Loading…" : placeholder)}
        </Text>
        <Ionicons name="lock-closed" size={moderateScale(15)} color={Colors.textMuted} />
      </View>
    </View>
  );

  return (
    // Full-page Persian-blue gradient with orange glows, like the card.
    <LinearGradient
      colors={[VU.blueLight, VU.blue, VU.blueDeep]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.root}
    >
      <StatusBar barStyle="light-content" backgroundColor={VU.blue} />
      <View pointerEvents="none" style={styles.glowTop} />
      <View pointerEvents="none" style={styles.glowBottom} />

      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={goBack}
            style={styles.headerBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={moderateScale(20)} color={VU.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>VU Trading Competition</Text>
          <View style={styles.headerBtn} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* hero */}
          <View style={styles.hero}>
            <CompetitionScene paused={reduceMotion} />
            <Text style={styles.heroTitle} accessibilityRole="header">
              VU Trading{"\n"}Competition
            </Text>
          </View>

          {/* ── 1. Your details ───────────────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your details</Text>

            {lockedRow("Name", fullName, "—")}
            {lockedRow("Username", username ? `@${username}` : "", "Not set yet")}
            {lockedRow("Email", email, "—")}

            {/* Division dropdown */}
            <View style={styles.field}>
              <Text style={styles.label}>Division</Text>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setOpen((v) => !v)}
                style={[styles.box, styles.select, open && styles.selectOpen, divisionError && styles.selectError]}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={selected ? `Division, ${selected.label} selected` : "Select your division"}
              >
                <Text style={[styles.selectText, !selected && styles.placeholder]}>
                  {selected ? selected.label : "Select your division"}
                </Text>
                <Ionicons
                  name={open ? "chevron-up" : "chevron-down"}
                  size={moderateScale(18)}
                  color={VU.blue}
                />
              </TouchableOpacity>

              {open ? (
                <View style={styles.menu}>
                  {DIVISIONS.map((d, i) => {
                    const active = d.key === division;
                    return (
                      <TouchableOpacity
                        key={d.key}
                        activeOpacity={0.7}
                        onPress={() => {
                          setDivision(d.key);
                          setOpen(false);
                        }}
                        style={[styles.option, i > 0 && styles.optionDivider, active && styles.optionActive]}
                        accessibilityRole="menuitem"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.optionText, active && styles.optionTextActive]}>{d.label}</Text>
                        {active ? <Ionicons name="checkmark-circle" size={moderateScale(20)} color={VU.orange} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}

              {divisionError ? <Text style={styles.errorText}>Please select your division.</Text> : null}
            </View>

            <TouchableOpacity
              activeOpacity={0.9}
              onPress={handleJoin}
              style={[styles.joinBtn, !division && styles.joinBtnIdle]}
              accessibilityRole="button"
              accessibilityLabel="Join competition"
            >
              <Text style={styles.joinText}>Join competition</Text>
              <Ionicons name="arrow-forward" size={moderateScale(18)} color={VU.white} />
            </TouchableOpacity>
          </View>

          {/* ── 2. Overview ───────────────────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Overview</Text>
            <Text style={styles.body}>{OVERVIEW.text}</Text>

            <View style={styles.factsRow}>
              {OVERVIEW.facts.map((f) => (
                <View key={f.label} style={styles.fact}>
                  <Ionicons name={f.icon} size={moderateScale(18)} color={VU.orange} />
                  <Text style={styles.factValue} numberOfLines={1} adjustsFontSizeToFit>
                    {f.value}
                  </Text>
                  <Text style={styles.factLabel}>{f.label}</Text>
                </View>
              ))}
            </View>

            {OVERVIEW.steps.map((step, i) => (
              <View key={step.title} style={styles.step}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <View style={styles.stepBody}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepText}>{step.body}</Text>
                </View>
              </View>
            ))}

            <Text style={styles.note}>{OVERVIEW.note}</Text>
          </View>

          {/* ── 3. Rules ──────────────────────────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Competition rules</Text>

            {RULES.map((section, si) => (
              <View key={section.title} style={[styles.ruleSection, si > 0 && styles.ruleSectionGap]}>
                <View style={styles.ruleHead}>
                  <View style={styles.ruleIcon}>
                    <Ionicons name={section.icon} size={moderateScale(15)} color={VU.white} />
                  </View>
                  <Text style={styles.ruleTitle}>{section.title}</Text>
                </View>
                {section.items.map((text) => (
                  <View key={text} style={styles.ruleItem}>
                    <View style={styles.bullet} />
                    <Text style={styles.ruleText}>{text}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, backgroundColor: "transparent" },

  // orange glows, like the accent on the card
  glowTop: {
    position: "absolute",
    right: -moderateScale(90),
    top: -moderateScale(80),
    width: moderateScale(280),
    height: moderateScale(280),
    borderRadius: moderateScale(140),
    backgroundColor: VU.orange,
    opacity: 0.22,
  },
  glowBottom: {
    position: "absolute",
    left: -moderateScale(120),
    bottom: -moderateScale(100),
    width: moderateScale(300),
    height: moderateScale(300),
    borderRadius: moderateScale(150),
    backgroundColor: VU.orange,
    opacity: 0.14,
  },

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
    color: VU.white,
    fontSize: fontScale(17),
    fontWeight: "700",
  },
  content: {
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(40),
  },

  hero: { alignItems: "center", marginBottom: moderateScale(8) },
  heroTitle: {
    color: VU.white,
    fontSize: fontScale(26),
    lineHeight: fontScale(31),
    fontWeight: "800",
    letterSpacing: -0.5,
    textAlign: "center",
    marginTop: moderateScale(4),
  },

  // white cards on the blue page
  card: {
    backgroundColor: VU.white,
    borderRadius: 24,
    padding: moderateScale(20),
    marginTop: moderateScale(16),
    ...Shadows.card,
  },
  cardTitle: {
    color: Colors.text,
    fontSize: fontScale(18),
    fontWeight: "800",
    letterSpacing: -0.3,
    marginBottom: moderateScale(14),
  },
  body: {
    color: Colors.textSecondary,
    fontSize: fontScale(14),
    lineHeight: fontScale(21),
  },

  // form fields
  field: { marginBottom: moderateScale(14) },
  label: {
    color: Colors.textSecondary,
    fontSize: fontScale(12),
    fontWeight: "600",
    marginBottom: moderateScale(6),
  },
  box: {
    minHeight: moderateScale(48),
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: moderateScale(14),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  lockedBox: { backgroundColor: Colors.background },
  lockedText: {
    flex: 1,
    color: Colors.text,
    fontSize: fontScale(15),
    fontWeight: "500",
    marginRight: moderateScale(8),
  },
  placeholder: { color: Colors.textMuted },
  select: { backgroundColor: VU.white, borderColor: VU.blue },
  selectOpen: { borderWidth: 2 },
  selectError: { borderColor: Colors.danger },
  selectText: { color: Colors.text, fontSize: fontScale(15), fontWeight: "600" },
  menu: {
    marginTop: moderateScale(8),
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: VU.white,
    overflow: "hidden",
  },
  option: {
    minHeight: moderateScale(46),
    paddingHorizontal: moderateScale(14),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  optionActive: { backgroundColor: "#FFF3E8" },
  optionText: { color: Colors.text, fontSize: fontScale(15), fontWeight: "500" },
  optionTextActive: { color: VU.orangeDeep, fontWeight: "700" },
  errorText: {
    color: Colors.danger,
    fontSize: fontScale(12),
    marginTop: moderateScale(6),
  },
  joinBtn: {
    height: moderateScale(50),
    borderRadius: 25,
    backgroundColor: VU.orange,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: moderateScale(4),
  },
  joinBtnIdle: { opacity: 0.55 },
  joinText: {
    color: VU.white,
    fontSize: fontScale(15),
    fontWeight: "700",
    marginRight: moderateScale(8),
  },

  // overview
  factsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: moderateScale(16),
    marginBottom: moderateScale(8),
  },
  fact: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#FFF3E8",
    borderRadius: 16,
    paddingVertical: moderateScale(12),
    paddingHorizontal: moderateScale(6),
    marginHorizontal: moderateScale(4),
  },
  factValue: {
    color: VU.blueDeep,
    fontSize: fontScale(15),
    fontWeight: "800",
    marginTop: moderateScale(6),
  },
  factLabel: {
    color: Colors.textSecondary,
    fontSize: fontScale(11),
    marginTop: moderateScale(2),
    textAlign: "center",
  },
  step: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: moderateScale(12),
  },
  stepNum: {
    width: moderateScale(28),
    height: moderateScale(28),
    borderRadius: moderateScale(14),
    backgroundColor: VU.blue,
    alignItems: "center",
    justifyContent: "center",
    marginRight: moderateScale(12),
  },
  stepNumText: { color: VU.white, fontSize: fontScale(13), fontWeight: "700" },
  stepBody: { flex: 1 },
  stepTitle: { color: Colors.text, fontSize: fontScale(14), fontWeight: "700" },
  stepText: { color: Colors.textSecondary, fontSize: fontScale(12), marginTop: 1 },
  note: {
    color: VU.orangeDeep,
    fontSize: fontScale(12),
    fontWeight: "600",
    marginTop: moderateScale(16),
  },

  // rules
  ruleSection: {},
  ruleSectionGap: { marginTop: moderateScale(20) },
  ruleHead: { flexDirection: "row", alignItems: "center", marginBottom: moderateScale(8) },
  ruleIcon: {
    width: moderateScale(26),
    height: moderateScale(26),
    borderRadius: moderateScale(8),
    backgroundColor: VU.orange,
    alignItems: "center",
    justifyContent: "center",
    marginRight: moderateScale(10),
  },
  ruleTitle: { color: VU.blueDeep, fontSize: fontScale(15), fontWeight: "800" },
  ruleItem: { flexDirection: "row", marginTop: moderateScale(8) },
  bullet: {
    width: moderateScale(6),
    height: moderateScale(6),
    borderRadius: moderateScale(3),
    backgroundColor: VU.blue,
    marginTop: moderateScale(8),
    marginRight: moderateScale(10),
  },
  ruleText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: fontScale(13.5),
    lineHeight: fontScale(20),
  },
});

export default VuCompetitionPage;
