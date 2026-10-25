import React, { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import useStockOfTheDay from "../hooks/useStockOfTheDay";
import RevealCover from "../components/RevealCover";
import StockFaceOffResult from "../components/StockFaceOffResult";
import StockFaceOffQuestion, { QUESTION_BG } from "../components/StockFaceOffQuestion";
import { markFaceOffIntroSeen } from "../utils/faceOffIntro";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

/**
 * Stock of the Day.
 *
 * Today's sector and rounds come from the server (same for every user). Each
 * round is one question about two companies in that sector: tap the logo you
 * think wins. After the last round you see your score, "3 out of 5".
 */
const StockOfTheDayPage = ({ navigation, route }) => {
  const { state, loading, failed, submitting, reload, answer } = useStockOfTheDay();

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("MainTabs");
  };

  // The results screen is up: the game has been completed, so the animated intro
  // has done its job and never plays again for this account. (Answering 4 of 5 and
  // leaving does not reach this, so the intro still plays next time.)
  const resultShown = !!(state && state.complete && state.result);
  useEffect(() => {
    if (resultShown) markFaceOffIntroSeen();
  }, [resultShown]);

  // The first round with no answer yet (rounds are played in order).
  const current = useMemo(
    () => (state && !state.complete ? state.rounds.find((r) => r.pickedKey == null) || null : null),
    [state],
  );

  let content;
  if (loading && !state) {
    content = (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  } else if (!state) {
    content = (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>{failed ? "Couldn't load today's game" : "No game today"}</Text>
        <Text style={styles.emptyBody}>Check your connection and try again.</Text>
        <TouchableOpacity onPress={reload} style={styles.retryBtn} accessibilityRole="button">
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (state.complete && state.result) {
    content = <StockFaceOffResult
        key={state.date}
        result={state.result}
        sector={state.sector}
        navigation={navigation}
        onDone={goBack}
      />;
  } else if (current) {
    content = (
      <StockFaceOffQuestion
        onBack={goBack}
        // A fresh view per round replays the entrance and resets the highlight.
        key={`${state.date}-${current.index}`}
        round={current}
        total={state.total}
        answered={state.answered}
        sector={state.sector}
        submitting={submitting}
        onPick={answer}
      />
    );
  } else {
    // Complete but no result: should not happen, but never leave a blank screen.
    content = (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>All done for today</Text>
        <TouchableOpacity onPress={reload} style={styles.retryBtn} accessibilityRole="button">
          <Text style={styles.retryText}>Show my result</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // The question screen is its own full-bleed design (cobalt frame, its own back
  // button), so it skips the standard header and safe-area wrapper.
  if (current && state && !state.complete) {
    return (
      <>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <View style={{ flex: 1, backgroundColor: QUESTION_BG }}>{content}</View>
        <RevealCover trigger={route?.params?.revealAt} />
      </>
    );
  }

  return (
    <>
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
        <Text style={styles.headerTitle}>Stock of the Day</Text>
        <View style={styles.headerBtn} />
      </View>

      {content}
    </SafeAreaView>

    {/* Only after the first-time intro: the colour it flooded the screen with fades
        away slowly, revealing the game. Opened any other way there is no param. */}
    <RevealCover trigger={route?.params?.revealAt} />
    </>
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
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: moderateScale(32),
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    textAlign: "center",
  },
  emptyBody: {
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.body),
    textAlign: "center",
    marginTop: moderateScale(8),
  },
  retryBtn: {
    marginTop: moderateScale(20),
    paddingHorizontal: moderateScale(24),
    paddingVertical: moderateScale(12),
    borderRadius: moderateScale(14),
    backgroundColor: Colors.primary,
  },
  retryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: fontScale(Typography.body),
  },
});

export default StockOfTheDayPage;
