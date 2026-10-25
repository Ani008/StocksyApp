import React, { useEffect, useMemo, useRef, useState } from "react";
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
import RevealCover from "../components/RevealCover";
import { markFaceOffIntroSeen } from "../utils/faceOffIntro";
import {
  answersText,
  formatValue,
  isGrowthLabel,
  scoreHeadline,
  sidesOf,
} from "../utils/stockOfTheDay";
import { Colors, Shadows, Typography, fontScale, moderateScale } from "../theme";

const LOGO_TOKEN = "pk_Bym4BAakTJudMK4MGnfpnw"; // same public logo.dev key used across the app
const logoUri = (domain) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}`;

// The server sends which stocks to show; the logo domain lives in the app's own
// stock list, so look it up by instrument key.
const DOMAIN_BY_KEY = new Map(INSTRUMENTS.map((s) => [s.key, s.domain]));
const META_BY_KEY = new Map(INSTRUMENTS.map((s) => [s.key, s]));

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

/** Small round company logo used on the result cards. */
function MiniLogo({ stock, size }) {
  const domain = DOMAIN_BY_KEY.get(stock.key);
  const [failed, setFailed] = useState(false);
  return (
    <View style={[styles.miniLogo, { width: size, height: size, borderRadius: size * 0.28 }]}>
      {failed || !domain ? (
        <Text style={styles.miniFallback}>{stock.symbol.slice(0, 2).toUpperCase()}</Text>
      ) : (
        <Image
          source={{ uri: logoUri(domain) }}
          style={{ width: size * 0.66, height: size * 0.66 }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

/** One side of a result card: logo, name, the number compared, and who won / who you picked. */
function SideColumn({ stock, valueText, isWinner, isPicked, winnerTag }) {
  return (
    <View style={[styles.side, isWinner && styles.sideWinner]}>
      <MiniLogo stock={stock} size={moderateScale(56)} />
      <Text style={styles.sideName} numberOfLines={2}>
        {stock.name}
      </Text>
      <Text style={[styles.sideValue, isWinner && styles.sideValueWinner]}>{valueText}</Text>
      <View style={styles.tagRow}>
        {isWinner && (
          <View style={[styles.tag, styles.tagWinner]}>
            <Text style={styles.tagWinnerText}>{winnerTag || "HIGHER"}</Text>
          </View>
        )}
        {isPicked && (
          <View style={[styles.tag, styles.tagPick]}>
            <Text style={styles.tagPickText}>YOUR PICK</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** One round of the result: the question, both companies' numbers, right/wrong, View stock. */
function RevealCard({ round, anim, onViewStock }) {
  const { winner, picked } = sidesOf(round);
  const signed = isGrowthLabel(round.label);
  const fmt = (v) => formatValue(round.unit, v, { signed });
  const winnerStock = winner === "left" ? round.left : round.right;

  return (
    <Animated.View
      style={[
        styles.revealCard,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
      ]}
    >
      <View style={styles.revealHead}>
        <Ionicons
          name={round.correct ? "checkmark-circle" : "close-circle"}
          size={moderateScale(22)}
          color={round.correct ? Colors.success : Colors.danger}
        />
        <View style={styles.revealHeadText}>
          <Text style={styles.revealQuestion}>{round.text}</Text>
          <Text style={styles.revealMeta}>
            {round.label}
            {round.fiscalYear ? ` · FY${round.fiscalYear}` : ""}
          </Text>
        </View>
      </View>

      <View style={styles.sides}>
        <SideColumn
          stock={round.left}
          valueText={fmt(round.leftValue)}
          isWinner={winner === "left"}
          isPicked={picked === "left"}
          winnerTag={round.winnerTag}
        />
        <SideColumn
          stock={round.right}
          valueText={fmt(round.rightValue)}
          isWinner={winner === "right"}
          isPicked={picked === "right"}
          winnerTag={round.winnerTag}
        />
      </View>

      <TouchableOpacity
        onPress={() => onViewStock(winnerStock)}
        style={styles.viewBtn}
        accessibilityRole="button"
        accessibilityLabel={`View ${winnerStock.name}`}
      >
        <Text style={styles.viewBtnText}>View {winnerStock.symbol}</Text>
        <Ionicons name="arrow-forward" size={moderateScale(14)} color={Colors.primary} />
      </TouchableOpacity>
    </Animated.View>
  );
}

/**
 * The finished game. The score pops in and counts up, then each question's
 * card slides in one after another with the real numbers behind it.
 */
function ResultView({ result, sector, navigation, onDone }) {
  const { score, total, rounds } = result;

  const pop = useRef(new Animated.Value(0)).current; // score circle scale/opacity
  const count = useRef(new Animated.Value(0)).current; // 0 -> score
  const cardAnims = useRef(rounds.map(() => new Animated.Value(0))).current;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = count.addListener(({ value }) => setShown(Math.round(value)));
    Animated.sequence([
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 14 }),
      // The count drives JS state, so it can't use the native driver.
      Animated.timing(count, { toValue: score, duration: 200 + score * 250, useNativeDriver: false }),
      Animated.stagger(
        140,
        cardAnims.map((a) => Animated.timing(a, { toValue: 1, duration: 320, useNativeDriver: true })),
      ),
    ]).start();
    return () => count.removeListener(id);
    // The result for a finished day never changes, so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const viewStock = (stock) => {
    const meta = META_BY_KEY.get(stock.key);
    navigation.navigate("StockDetail", {
      instrumentKey: stock.key,
      symbol: stock.symbol,
      name: stock.name,
      sector: meta?.sector || sector,
      domain: meta?.domain,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.resultContent} showsVerticalScrollIndicator={false}>
      <View style={styles.chip}>
        <Text style={styles.chipText}>{sector.toUpperCase()}</Text>
      </View>

      <Animated.Text style={[styles.headline, { opacity: pop }]}>{scoreHeadline(score, total)}</Animated.Text>
      <Animated.View
        style={[
          styles.scoreCircle,
          { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] },
        ]}
        accessible
        accessibilityLabel={`You got ${score} out of ${total} right`}
      >
        <Text style={styles.scoreBig}>{shown}</Text>
        <Text style={styles.scoreOf}>out of {total}</Text>
      </Animated.View>
      <Text style={styles.scoreCaption}>
        {answersText(score)} right today. Come back tomorrow for a new sector.
      </Text>

      <View style={styles.cards}>
        {rounds.map((r, i) => (
          <RevealCard key={r.index} round={r} anim={cardAnims[i]} onViewStock={viewStock} />
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
    content = <ResultView
        key={state.date}
        result={state.result}
        sector={state.sector}
        navigation={navigation}
        onDone={goBack}
      />;
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
  cards: {
    alignSelf: "stretch",
    marginTop: moderateScale(28),
    gap: moderateScale(14),
  },
  revealCard: {
    backgroundColor: Colors.surface,
    borderRadius: moderateScale(20),
    padding: moderateScale(16),
    ...Shadows.card,
  },
  revealHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(10),
  },
  revealHeadText: { flex: 1 },
  revealQuestion: {
    color: Colors.text,
    fontSize: fontScale(Typography.body),
    fontWeight: "700",
  },
  revealMeta: {
    color: Colors.textMuted,
    fontSize: fontScale(Typography.small),
    fontWeight: "600",
    marginTop: moderateScale(2),
  },
  sides: {
    flexDirection: "row",
    gap: moderateScale(10),
    marginTop: moderateScale(14),
  },
  side: {
    flex: 1,
    alignItems: "center",
    paddingVertical: moderateScale(12),
    paddingHorizontal: moderateScale(8),
    borderRadius: moderateScale(16),
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: Colors.surfaceAlt,
  },
  sideWinner: {
    borderColor: Colors.success,
    backgroundColor: Colors.successBg,
  },
  miniLogo: {
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  miniFallback: {
    color: Colors.textSecondary,
    fontSize: fontScale(18),
    fontWeight: "800",
  },
  sideName: {
    marginTop: moderateScale(8),
    textAlign: "center",
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.small),
    fontWeight: "600",
    minHeight: fontScale(Typography.small) * 2.6,
  },
  sideValue: {
    marginTop: moderateScale(4),
    color: Colors.text,
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "800",
    textAlign: "center",
  },
  sideValueWinner: { color: Colors.success },
  tagRow: {
    marginTop: moderateScale(8),
    minHeight: moderateScale(40),
    gap: moderateScale(4),
    alignItems: "center",
  },
  tag: {
    borderRadius: moderateScale(6),
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(2),
  },
  tagWinner: { backgroundColor: Colors.success },
  tagWinnerText: { color: "#fff", fontSize: fontScale(10), fontWeight: "800", letterSpacing: 0.6 },
  tagPick: { backgroundColor: Colors.primaryLight },
  tagPickText: { color: Colors.primaryDark, fontSize: fontScale(10), fontWeight: "800", letterSpacing: 0.6 },
  viewBtn: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(6),
    marginTop: moderateScale(12),
    paddingVertical: moderateScale(6),
    paddingHorizontal: moderateScale(12),
  },
  viewBtnText: {
    color: Colors.primary,
    fontSize: fontScale(Typography.body),
    fontWeight: "700",
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
