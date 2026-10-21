import React from "react";
import { ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

import StreakCard from "../components/StreakCard";
import StreakCalendar from "../components/StreakCalendar";
import useStreak from "../hooks/useStreak";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

/**
 * The streak body: today's streak card, then a year of activity.
 * Display only. The Home screen is what records the daily check-in.
 *
 * Exported separately so the Daily Challenge page can show the exact same
 * content under its "Streaks" toggle. It renders no header / ScrollView of its
 * own, so the host screen decides the scrolling and chrome.
 */
export const StreakContent = ({ style }) => {
  const streak = useStreak({ readOnly: true });
  const refresh = streak.recheck;

  // Re-read on focus so it is right after midnight or a new check-in.
  useFocusEffect(
    React.useCallback(() => {
      refresh();
    }, [refresh]),
  );

  if (streak.loading) return null;

  return (
    <View style={style}>
      <StreakCard
        streak={streak.streak}
        longest={streak.longest}
        week={streak.week}
        message={streak.message}
        celebrate={false}
      />

      <StreakCalendar
        style={styles.calendar}
        today={streak.today}
        history={streak.history}
      />
    </View>
  );
};

/**
 * The full streak page (standalone, opened from Profile).
 */
const StreakPage = ({ navigation }) => {
  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("MainTabs");
  };

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

        <Text style={styles.headerTitle}>Streak</Text>

        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <StreakContent />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
  },
  content: {
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(40),
  },
  calendar: { marginTop: moderateScale(16) },
});

export default StreakPage;
