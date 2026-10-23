import React, { useState } from "react";
import { ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import SegmentedToggle from "../components/SegmentedToggle";
import NiftyPredictionCard from "../components/NiftyPredictionCard";
import DailyQuizCard from "../components/DailyQuizCard";
import StockOfTheDayCard from "../components/StockOfTheDayCard";
import ChallengeFriendCard from "../components/ChallengeFriendCard";
import useMarketData from "../hooks/useMarketData";
import { StreakContent } from "./StreakPage";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const TABS = [
  { key: "challenge", label: "Daily Challenge & Games" },
  { key: "streaks", label: "Streaks" },
];

// Same % change maths the Dashboard uses for the Nifty card.
const calcChange = (ltp, cp) => {
  if (!ltp || !cp || cp === 0) return null;
  const pct = ((ltp - cp) / cp) * 100;
  const sign = pct >= 0 ? "▲" : "▼";
  return {
    label: `${sign} ${Math.abs(pct).toFixed(2)}%`,
    isPositive: pct >= 0,
  };
};

/**
 * Daily Challenge page.
 *
 * A toggle at the top switches between:
 *   - "Daily Challenge & Games" (default): the daily Nifty prediction card
 *   - "Streaks": the streak card + activity calendar (same as StreakPage)
 */
const DailyChallengePage = ({ navigation }) => {
  const [tab, setTab] = useState("challenge");

  // Live Nifty 50, from the shared market socket (same key the Dashboard uses).
  const { prices } = useMarketData();
  const nifty = prices["NSE_INDEX|Nifty 50"];
  const niftyLtp = nifty?.ltp;
  const niftyChange = nifty ? calcChange(nifty.ltp, nifty.cp) : null;

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

        <Text style={styles.headerTitle}>Daily Challenge</Text>

        <View style={styles.headerBtn} />
      </View>

      <View style={styles.toggleRow}>
        <SegmentedToggle
          theme="neutral"
          value={tab}
          onChange={setTab}
          options={TABS}
          style={styles.toggle}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {tab === "challenge" ? (
          <>
            <NiftyPredictionCard niftyLtp={niftyLtp} niftyChange={niftyChange} />
            <View style={styles.widgetRow}>
              <DailyQuizCard />
              <StockOfTheDayCard onPress={() => navigation.navigate("StockOfTheDay")} />
            </View>
            <ChallengeFriendCard style={styles.challengeCard} />
          </>
        ) : (
          <StreakContent />
        )}
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
  toggleRow: {
    paddingHorizontal: moderateScale(20),
    marginBottom: moderateScale(16),
  },
  toggle: { alignSelf: "center" },
  content: {
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(40),
  },
  // Square widgets sit in a row under the Nifty card (two-up grid; more games can join later).
  widgetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: moderateScale(16),
  },
  challengeCard: { marginTop: moderateScale(16) },
});

export default DailyChallengePage;
