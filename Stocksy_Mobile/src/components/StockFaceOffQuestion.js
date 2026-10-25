import React, { useEffect, useRef, useState } from "react";
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { DOMAIN_BY_KEY, logoUri } from "../utils/stockLogo";
import { range, useLoop, useReduceMotion } from "../hooks/useMotion";
import { fontScale, moderateScale } from "../theme";

export const QUESTION_BG = "#0047AB"; // the cobalt that frames the three blocks

const INK = "#1E1E1E";
const LIME = "#E8FF8C";
const SKY = "#A5DBFF";
const DOT = "#C9D1DC";
const GAP = moderateScale(8); // the cobalt seam between blocks
const PICK_DELAY = 520; // let the lock-in animation play before the answer is sent

/** One company's big white card. Idle it floats; tapped it pops with a ring and a tick; the other one steps back. */
function ChoiceCard({ stock, width, height, mode, disabled, onPress, enter, phase, animate }) {
  const [failed, setFailed] = useState(false);
  const domain = DOMAIN_BY_KEY.get(stock.key);

  const press = useRef(new Animated.Value(1)).current;
  const sel = useRef(new Animated.Value(0)).current; // 1 when this card is the pick
  const dim = useRef(new Animated.Value(0)).current; // 1 when the other card is the pick
  const ripple = useRef(new Animated.Value(0)).current;
  const float = useLoop(animate && mode === "idle", 2600, phase);

  useEffect(() => {
    Animated.spring(sel, { toValue: mode === "selected" ? 1 : 0, useNativeDriver: true, speed: 14, bounciness: 14 }).start();
    Animated.spring(dim, { toValue: mode === "dimmed" ? 1 : 0, useNativeDriver: true, speed: 14, bounciness: 4 }).start();
    if (mode === "selected" && animate) {
      ripple.setValue(0);
      Animated.timing(ripple, { toValue: 1, duration: 650, useNativeDriver: true }).start();
    }
  }, [mode, animate, sel, dim, ripple]);

  const pressTo = (to) =>
    Animated.spring(press, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 8 }).start();

  const radius = moderateScale(28);
  const logo = width * 0.46;

  return (
    <Animated.View
      style={{
        opacity: Animated.multiply(enter, range(dim, 1, 0.38)),
        transform: [
          { translateY: range(enter, 46, 0) },
          { rotate: range(enter, phase ? "7deg" : "-7deg", "0deg") },
          { scale: range(enter, 0.6, 1) },
          { translateY: range(float, -4, 4) },
          { scale: press },
          { scale: range(sel, 1, 1.07) },
          { scale: range(dim, 1, 0.92) },
        ],
      }}
    >
      {/* the expanding ring when this card is locked in */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          width,
          height,
          borderRadius: radius,
          borderWidth: 3,
          borderColor: QUESTION_BG,
          opacity: range(ripple, 0.7, 0),
          transform: [{ scale: range(ripple, 1, 1.35) }],
        }}
      />
      <TouchableOpacity
        activeOpacity={1}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => pressTo(0.94)}
        onPressOut={() => pressTo(1)}
        accessibilityRole="button"
        accessibilityLabel={`Pick ${stock.name}`}
        accessibilityState={{ selected: mode === "selected", disabled }}
        style={[styles.card, { width, height, borderRadius: radius }]}
      >
        {failed || !domain ? (
          <Text style={styles.fallback}>{stock.symbol.slice(0, 2).toUpperCase()}</Text>
        ) : (
          <Image
            source={{ uri: logoUri(domain) }}
            style={{ width: logo, height: logo }}
            resizeMode="contain"
            onError={() => setFailed(true)}
          />
        )}
        <Text style={styles.cardName} numberOfLines={2}>
          {stock.name}
        </Text>

        <Animated.View
          pointerEvents="none"
          style={[styles.ring, { borderRadius: radius, opacity: sel }]}
        />
        <Animated.View style={[styles.tick, { transform: [{ scale: sel }], opacity: sel }]}>
          <Ionicons name="checkmark" size={moderateScale(16)} color={LIME} />
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

/** One dot per round. Answered = cobalt (the last one pops in), current = lime and pulsing. */
function Dot({ state, justDone, animate }) {
  const pop = useRef(new Animated.Value(justDone ? 0 : 1)).current;
  const pulse = useLoop(animate && state === "current", 900);
  useEffect(() => {
    if (justDone) Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 18 }).start();
  }, [justDone, pop]);
  return (
    <Animated.View
      style={[
        styles.dot,
        state === "done" && styles.dotDone,
        state === "current" && styles.dotCurrent,
        {
          transform: [
            { scale: pop },
            ...(state === "current" ? [{ scale: range(pulse, 1, 1.35) }] : []),
          ],
        },
      ]}
    />
  );
}

/** The question, one word at a time. */
function Question({ text, animate, started }) {
  const words = text.split(" ").filter(Boolean);
  const anims = useRef(words.map(() => new Animated.Value(animate ? 0 : 1))).current;
  useEffect(() => {
    if (!started || !animate) {
      anims.forEach((a) => a.setValue(1));
      return;
    }
    Animated.stagger(
      70,
      anims.map((a) => Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 10 })),
    ).start();
  }, [started, animate, anims]);

  const long = text.length > 44;
  return (
    <View style={styles.qWrap} accessible accessibilityRole="header" accessibilityLabel={text}>
      {words.map((w, i) => (
        <Animated.Text
          key={i}
          style={[
            styles.qWord,
            { fontSize: fontScale(long ? 27 : 31), lineHeight: fontScale(long ? 33 : 38) },
            { opacity: anims[i], transform: [{ translateY: range(anims[i], 22, 0) }] },
          ]}
        >
          {w}
        </Animated.Text>
      ))}
    </View>
  );
}

/**
 * The round being played, as three blocks on cobalt: the question (white), a
 * lime hint strip, and the two companies on a light-blue panel. Everything
 * slides in, the question lands word by word, then the cards float and the VS
 * badge pulses. Tapping a card locks it in with a pop, a ring and a tick while
 * the other steps back; the answer is sent once that has had a moment to play.
 */
export default function StockFaceOffQuestion({ round, total, answered, sector, submitting, onPick, onBack }) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const animate = !reduce;

  const [rowWidth, setRowWidth] = useState(0);
  const [pending, setPending] = useState(null); // the key just tapped, while it is being locked in
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const enterWhite = useRef(new Animated.Value(0)).current;
  const enterStrip = useRef(new Animated.Value(0)).current;
  const enterPanel = useRef(new Animated.Value(0)).current;
  const enterCards = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
  const [textStarted, setTextStarted] = useState(false);

  useEffect(() => {
    const spring = (v, speed = 10) => Animated.spring(v, { toValue: 1, useNativeDriver: true, speed, bounciness: 8 });
    if (!animate) {
      [enterWhite, enterStrip, enterPanel, ...enterCards].forEach((v) => v.setValue(1));
      setTextStarted(true);
      return undefined;
    }
    const t = setTimeout(() => setTextStarted(true), 220);
    Animated.sequence([
      spring(enterWhite, 9),
      Animated.parallel([
        spring(enterStrip),
        Animated.sequence([Animated.delay(60), spring(enterPanel)]),
        Animated.sequence([Animated.delay(200), Animated.stagger(120, enterCards.map((c) => spring(c, 9)))]),
      ]),
    ]).start();
    return () => clearTimeout(t);
    // One entrance per round: the parent remounts this view for each new round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vs = useLoop(animate, 1100, 600);
  const nudge = useLoop(animate && !pending, 800); // the little hand on the hint strip
  const lock = useRef(new Animated.Value(0)).current;

  const pick = async (key) => {
    if (submitting || pending) return;
    setPending(key);
    Animated.spring(lock, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 14 }).start();
    if (animate) await new Promise((r) => setTimeout(r, PICK_DELAY));
    const ok = await onPick(round.index, key);
    if (!ok && alive.current) {
      // The round stays open, so let them try again.
      setPending(null);
      lock.setValue(0);
    }
  };

  const padX = moderateScale(22);
  const gap = moderateScale(14);
  const cardW = rowWidth > 0 ? Math.floor((rowWidth - gap) / 2) : 0;
  const cardH = Math.round(cardW * 0.88);

  const modeOf = (key) => (pending === key ? "selected" : pending ? "dimmed" : "idle");

  return (
    <View style={styles.root}>
      {/* 1. question */}
      <Animated.View
        style={[
          styles.white,
          {
            paddingTop: insets.top + moderateScale(14),
            paddingHorizontal: padX,
            opacity: enterWhite,
            transform: [{ translateY: range(enterWhite, -70, 0) }],
          },
        ]}
      >
        <View style={styles.topRow}>
          <View style={styles.topLeft}>
            <TouchableOpacity
              onPress={onBack}
              style={styles.back}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={moderateScale(18)} color={INK} />
            </TouchableOpacity>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{sector.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={styles.round}>
            Round {answered + 1} of {total}
          </Text>
        </View>

        <View
          style={styles.dots}
          accessible
          accessibilityLabel={`Round ${Math.min(answered + 1, total)} of ${total}`}
        >
          {Array.from({ length: total }, (_, i) => (
            <Dot
              key={i}
              state={i < answered ? "done" : i === answered ? "current" : "todo"}
              justDone={i === answered - 1}
              animate={animate}
            />
          ))}
        </View>

        <View style={styles.qArea}>
          <Question text={round.text} animate={animate} started={textStarted} />
        </View>
      </Animated.View>

      {/* 2. hint */}
      <Animated.View
        style={[
          styles.strip,
          {
            opacity: enterStrip,
            transform: [{ translateX: range(enterStrip, -50, 0) }, { scale: range(lock, 1, 1.025) }],
          },
        ]}
      >
        <Text style={styles.stripText}>
          {pending ? "LOCKED IN. LET'S SEE HOW YOU DID." : "TAP THE LOGO YOU THINK WINS. YOUR PICK LOCKS IN."}
        </Text>
        <Animated.View
          style={{
            transform: pending
              ? []
              : [{ translateX: range(nudge, -3, 5) }, { translateY: range(nudge, 3, -3) }, { rotate: range(nudge, "-8deg", "8deg") }],
          }}
        >
          <Ionicons name={pending ? "lock-closed" : "hand-left"} size={moderateScale(22)} color={INK} />
        </Animated.View>
      </Animated.View>

      {/* 3. the two companies */}
      <Animated.View
        style={[
          styles.panel,
          {
            paddingHorizontal: padX,
            paddingBottom: insets.bottom + moderateScale(26),
            opacity: enterPanel,
            transform: [{ translateY: range(enterPanel, 90, 0) }],
          },
        ]}
      >
        <View style={styles.row} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
          {cardW > 0 && (
            <>
              <ChoiceCard
                stock={round.left}
                width={cardW}
                height={cardH}
                mode={modeOf(round.left.key)}
                disabled={!!pending}
                onPress={() => pick(round.left.key)}
                enter={enterCards[0]}
                phase={0}
                animate={animate}
              />
              <ChoiceCard
                stock={round.right}
                width={cardW}
                height={cardH}
                mode={modeOf(round.right.key)}
                disabled={!!pending}
                onPress={() => pick(round.right.key)}
                enter={enterCards[1]}
                phase={900}
                animate={animate}
              />
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.vsWrap,
                  {
                    top: cardH / 2 - moderateScale(21),
                    opacity: enterCards[1],
                    transform: [
                      { scale: Animated.multiply(range(enterCards[1], 0, 1), range(vs, 0.92, 1.12)) },
                      { rotate: range(vs, "-6deg", "6deg") },
                    ],
                  },
                ]}
              >
                <View style={styles.vs}>
                  <Text style={styles.vsText}>VS</Text>
                </View>
              </Animated.View>
            </>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: QUESTION_BG },
  white: {
    flex: 1,
    backgroundColor: "#fff",
    borderBottomLeftRadius: moderateScale(40),
    borderBottomRightRadius: moderateScale(40),
    paddingBottom: moderateScale(28),
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topLeft: { flexDirection: "row", alignItems: "center", gap: moderateScale(10) },
  back: {
    width: moderateScale(34),
    height: moderateScale(34),
    borderRadius: moderateScale(17),
    backgroundColor: "#F1F3F6",
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    backgroundColor: LIME,
    borderRadius: moderateScale(9),
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(7),
  },
  chipText: { color: INK, fontSize: fontScale(14), fontWeight: "900", letterSpacing: 0.3 },
  round: { color: INK, fontSize: fontScale(13), fontWeight: "600" },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: moderateScale(10),
    marginTop: moderateScale(16),
  },
  dot: { width: moderateScale(14), height: moderateScale(14), borderRadius: moderateScale(7), backgroundColor: DOT },
  dotDone: { backgroundColor: QUESTION_BG },
  dotCurrent: { backgroundColor: LIME, borderWidth: 2.5, borderColor: INK },
  qArea: { flex: 1, justifyContent: "center", paddingTop: moderateScale(12) },
  qWrap: { flexDirection: "row", flexWrap: "wrap", columnGap: moderateScale(10), rowGap: moderateScale(2) },
  qWord: { color: INK, fontWeight: "800", letterSpacing: -0.3 },
  strip: {
    marginTop: GAP,
    backgroundColor: LIME,
    borderRadius: moderateScale(30),
    paddingVertical: moderateScale(22),
    paddingHorizontal: moderateScale(22),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: moderateScale(12),
  },
  stripText: { flex: 1, color: INK, fontSize: fontScale(12.5), lineHeight: fontScale(18), fontWeight: "700", letterSpacing: 0.3 },
  panel: {
    marginTop: GAP,
    backgroundColor: SKY,
    borderTopLeftRadius: moderateScale(36),
    borderTopRightRadius: moderateScale(36),
    paddingTop: moderateScale(26),
  },
  row: { flexDirection: "row", justifyContent: "space-between" },
  card: {
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: moderateScale(10),
    shadowColor: "#0A2A5E",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 5,
  },
  cardName: {
    marginTop: moderateScale(10),
    textAlign: "center",
    color: INK,
    opacity: 0.7,
    fontSize: fontScale(11),
    lineHeight: fontScale(14),
    fontWeight: "700",
  },
  fallback: { color: INK, opacity: 0.55, fontSize: fontScale(40), fontWeight: "900" },
  ring: { ...StyleSheet.absoluteFillObject, borderWidth: 4, borderColor: QUESTION_BG },
  tick: {
    position: "absolute",
    top: moderateScale(-8),
    right: moderateScale(-8),
    width: moderateScale(30),
    height: moderateScale(30),
    borderRadius: moderateScale(15),
    backgroundColor: QUESTION_BG,
    borderWidth: 3,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  vsWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  vs: {
    width: moderateScale(42),
    height: moderateScale(42),
    borderRadius: moderateScale(21),
    backgroundColor: QUESTION_BG,
    borderWidth: 3,
    borderColor: SKY,
    alignItems: "center",
    justifyContent: "center",
  },
  vsText: { color: LIME, fontSize: fontScale(13), fontWeight: "900", letterSpacing: 0.4 },
});
