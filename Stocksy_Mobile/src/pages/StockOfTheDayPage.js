import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { INSTRUMENTS } from "./SearchPage";
import useStockOfTheDay from "../hooks/useStockOfTheDay";
import { Colors, Shadows, Typography, fontScale, moderateScale } from "../theme";

const LOGO_TOKEN = "pk_Bym4BAakTJudMK4MGnfpnw"; // same public logo.dev key used across the app
const logoUri = (domain) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}`;

// The server sends which stocks to show; the logo domain lives in the app's own
// stock list, so look it up by instrument key.
const DOMAIN_BY_KEY = new Map(INSTRUMENTS.map((s) => [s.key, s.domain]));

/**
 * One big tappable company logo. If the logo can't load (or we have no domain
 * for it) the ticker's first letters are shown instead, so a round is never
 * unplayable.
 */
function LogoButton({ stock, selected, dimmed, disabled, onPress, size }) {
  const scale = useRef(new Animated.Value(1)).current;
  const domain = DOMAIN_BY_KEY.get(stock.key);
  const [failed, setFailed] = useState(false);

  const pressTo = (to) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 30, bounciness: 8 }).start();

  return (
    <Animated.View style={{ transform: [{ scale }], opacity: dimmed ? 0.45 : 1 }}>
      <TouchableOpacity
        activeOpacity={1}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => pressTo(0.94)}
        onPressOut={() => pressTo(1)}
        accessibilityRole="button"
        accessibilityLabel={`Pick ${stock.name}`}
        accessibilityState={{ selected, disabled }}
        style={[
          styles.logoCard,
          { width: size, height: size },
          selected && styles.logoCardSelected,
        ]}
      >
        {failed || !domain ? (
          <Text style={styles.fallback}>{stock.symbol.slice(0, 2).toUpperCase()}</Text>
        ) : (
          <Image
            source={{ uri: logoUri(domain) }}
            style={{ width: size * 0.62, height: size * 0.62 }}
            resizeMode="contain"
            onError={() => setFailed(true)}
          />
        )}
        {selected && (
          <View style={styles.tick}>
            <Ionicons name="checkmark" size={moderateScale(14)} color="#fff" />
          </View>
        )}
      </TouchableOpacity>
      <Text style={styles.stockName} numberOfLines={2}>
        {stock.name}
      </Text>
    </Animated.View>
  );
}

/** One dot per round: filled = answered, ring = the one being played. */
function ProgressDots({ total, answered }) {
  return (
    <View style={styles.dots} accessibilityLabel={`Round ${Math.min(answered + 1, total)} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i < answered && styles.dotDone,
            i === answered && styles.dotCurrent,
          ]}
        />
      ))}
    </View>
  );
}

/** The round being played: the question, two logos, tap one to lock it in. */
function RoundView({ round, total, answered, sector, submitting, onPick }) {
  const [rowWidth, setRowWidth] = useState(0);
  const [pending, setPending] = useState(null); // the key just tapped, while it is being locked in

  const gap = moderateScale(20);
  const size = rowWidth > 0 ? Math.floor((rowWidth - gap) / 2) : 0;

  const pick = async (key) => {
    if (submitting || pending) return;
    setPending(key);
    const ok = await onPick(round.index, key);
    if (!ok) setPending(null); // the round stays open, so let them try again
  };

  return (
    <View style={styles.body}>
      <View style={styles.chipRow}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{sector.toUpperCase()}</Text>
        </View>
        <Text style={styles.round}>
          Round {answered + 1} of {total}
        </Text>
      </View>

      <ProgressDots total={total} answered={answered} />

      <Text style={styles.question} accessibilityRole="header">
        {round.text}
      </Text>

      <View style={styles.row} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
        {size > 0 && (
          <>
            <LogoButton
              stock={round.left}
              size={size}
              selected={pending === round.left.key}
              dimmed={pending === round.right.key}
              disabled={!!pending}
              onPress={() => pick(round.left.key)}
            />
            <LogoButton
              stock={round.right}
              size={size}
              selected={pending === round.right.key}
              dimmed={pending === round.left.key}
              disabled={!!pending}
              onPress={() => pick(round.right.key)}
            />
            <View pointerEvents="none" style={[styles.vsWrap, { top: size / 2 - moderateScale(20) }]}>
              <View style={styles.vs}>
                <Text style={styles.vsText}>VS</Text>
              </View>
            </View>
          </>
        )}
      </View>

      <Text style={styles.hint}>Tap the logo you think wins. Your pick locks in.</Text>
    </View>
  );
}

const headlineFor = (score, total) => {
  if (score === total) return "Perfect score!";
  if (score >= Math.ceil(total * 0.6)) return "Nice one!";
  return "Tougher than it looks";
};

/** The finished game: "3 out of 5", plus what each question's answer was. */
function ResultView({ result, sector, onDone }) {
  const nameOf = (r, key) => (r.left.key === key ? r.left.name : r.right.name);

  return (
    <ScrollView contentContainerStyle={styles.resultContent} showsVerticalScrollIndicator={false}>
      <View style={styles.chip}>
        <Text style={styles.chipText}>{sector.toUpperCase()}</Text>
      </View>

      <Text style={styles.headline}>{headlineFor(result.score, result.total)}</Text>
      <View style={styles.scoreCircle}>
        <Text style={styles.scoreBig}>{result.score}</Text>
        <Text style={styles.scoreOf}>out of {result.total}</Text>
      </View>
      <Text style={styles.scoreCaption}>
        {result.score === 1 ? "1 answer" : `${result.score} answers`} right today. Come back tomorrow for a new sector.
      </Text>

      <View style={styles.recap}>
        {result.rounds.map((r) => (
          <View key={r.index} style={styles.recapRow}>
            <Ionicons
              name={r.correct ? "checkmark-circle" : "close-circle"}
              size={moderateScale(24)}
              color={r.correct ? Colors.success : Colors.danger}
            />
            <View style={styles.recapText}>
              <Text style={styles.recapQuestion}>{r.text}</Text>
              <Text style={styles.recapAnswer}>
                {r.label}: {nameOf(r, r.winnerKey)} was higher
                {r.correct ? "" : `. You picked ${nameOf(r, r.pickedKey)}.`}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity onPress={onDone} style={styles.doneBtn} accessibilityRole="button">
        <Text style={styles.doneText}>Done</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/**
 * Stock of the Day.
 *
 * Today's sector and rounds come from the server (same for every user). Each
 * round is one question about two companies in that sector: tap the logo you
 * think wins. After the last round you see your score, "3 out of 5".
 */
const StockOfTheDayPage = ({ navigation }) => {
  const { state, loading, failed, submitting, reload, answer } = useStockOfTheDay();

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("MainTabs");
  };

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
    content = <ResultView result={state.result} sector={state.sector} onDone={goBack} />;
  } else if (current) {
    content = (
      <RoundView
        // A fresh view per round resets the highlight and the press animation.
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
        <Text style={styles.headerTitle}>Stock of the Day</Text>
        <View style={styles.headerBtn} />
      </View>

      {content}
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
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: moderateScale(32),
  },
  body: {
    flex: 1,
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(8),
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chip: {
    alignSelf: "flex-start",
    backgroundColor: "#FEF3C7",
    borderRadius: moderateScale(8),
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(4),
  },
  chipText: {
    color: "#92400E",
    fontSize: fontScale(11),
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  round: {
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.small),
    fontWeight: "600",
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: moderateScale(8),
    marginTop: moderateScale(18),
  },
  dot: {
    width: moderateScale(10),
    height: moderateScale(10),
    borderRadius: moderateScale(5),
    backgroundColor: Colors.border,
  },
  dotDone: { backgroundColor: Colors.primary },
  dotCurrent: {
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  question: {
    color: Colors.text,
    fontSize: fontScale(24),
    lineHeight: fontScale(30),
    fontWeight: "800",
    letterSpacing: -0.4,
    textAlign: "center",
    marginTop: moderateScale(24),
    marginBottom: moderateScale(28),
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  logoCard: {
    backgroundColor: Colors.surface,
    borderRadius: moderateScale(28),
    borderWidth: 2,
    borderColor: "transparent",
    justifyContent: "center",
    alignItems: "center",
    ...Shadows.card,
  },
  logoCardSelected: {
    borderColor: Colors.primary,
  },
  fallback: {
    color: Colors.textSecondary,
    fontSize: fontScale(40),
    fontWeight: "800",
  },
  tick: {
    position: "absolute",
    top: moderateScale(10),
    right: moderateScale(10),
    width: moderateScale(24),
    height: moderateScale(24),
    borderRadius: moderateScale(12),
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  stockName: {
    marginTop: moderateScale(10),
    textAlign: "center",
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.small),
    fontWeight: "600",
  },
  vsWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  vs: {
    width: moderateScale(40),
    height: moderateScale(40),
    borderRadius: moderateScale(20),
    backgroundColor: Colors.text,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: Colors.background,
  },
  vsText: {
    color: "#fff",
    fontSize: fontScale(12),
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  hint: {
    textAlign: "center",
    color: Colors.textMuted,
    fontSize: fontScale(Typography.small),
    marginTop: moderateScale(28),
  },
  resultContent: {
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(8),
    paddingBottom: moderateScale(40),
    alignItems: "center",
  },
  headline: {
    color: Colors.text,
    fontSize: fontScale(26),
    fontWeight: "800",
    letterSpacing: -0.4,
    marginTop: moderateScale(20),
  },
  scoreCircle: {
    width: moderateScale(150),
    height: moderateScale(150),
    borderRadius: moderateScale(75),
    backgroundColor: Colors.surface,
    borderWidth: 6,
    borderColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    marginTop: moderateScale(20),
    ...Shadows.card,
  },
  scoreBig: {
    color: Colors.text,
    fontSize: fontScale(56),
    lineHeight: fontScale(60),
    fontWeight: "900",
  },
  scoreOf: {
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.small),
    fontWeight: "700",
  },
  scoreCaption: {
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.body),
    textAlign: "center",
    marginTop: moderateScale(16),
    paddingHorizontal: moderateScale(12),
  },
  recap: {
    alignSelf: "stretch",
    marginTop: moderateScale(28),
    backgroundColor: Colors.surface,
    borderRadius: moderateScale(20),
    padding: moderateScale(16),
    gap: moderateScale(16),
    ...Shadows.card,
  },
  recapRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(12),
  },
  recapText: { flex: 1 },
  recapQuestion: {
    color: Colors.text,
    fontSize: fontScale(Typography.body),
    fontWeight: "700",
  },
  recapAnswer: {
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.small),
    marginTop: moderateScale(2),
  },
  doneBtn: {
    alignSelf: "stretch",
    marginTop: moderateScale(24),
    backgroundColor: Colors.primary,
    borderRadius: moderateScale(16),
    paddingVertical: moderateScale(14),
    alignItems: "center",
  },
  doneText: {
    color: "#fff",
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
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
