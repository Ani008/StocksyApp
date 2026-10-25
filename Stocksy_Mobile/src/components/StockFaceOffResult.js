import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Line } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";

import { DOMAIN_BY_KEY, META_BY_KEY, logoUri } from "../utils/stockLogo";
import {
  answersText,
  categoryWord,
  formatValue,
  isGrowthLabel,
  scoreHeadline,
  sidesOf,
  valueFontSize,
} from "../utils/stockOfTheDay";
import { fontScale, moderateScale } from "../theme";

// Sticker-sheet palette: flat colour, thick black outline, hard offset shadow.
const INK = "#0A0A0A";
const PAPER = "#FFFFFF";
const GRID = "#E3E6EB";
const SKY = "#A5DBFF"; // category cards
const WIN = "#7ED957"; // the side that won the round
const LOSE = "#FF5A5A"; // the side that lost it
const LIME = "#E8FF8C"; // score badge
const COBALT = "#0047AB"; // buttons and the score ring
const PINK = "#FFB8E0";
const SUN = "#FFD84D";

const BORDER = 2.5;
const OFFSET = 6; // hard shadow offset
const GAP = 6;
const CELL = 44; // grid square

/**
 * A looping 0 -> 1 -> 0 value that eases both ways, so anything driven by it
 * "breathes" or floats. Stays parked at the middle when motion is reduced.
 */
function useLoop(enabled, duration, delay = 0) {
  const v = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (!enabled) {
      v.setValue(0.5);
      return undefined;
    }
    v.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const t = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(t);
      loop.stop();
    };
  }, [enabled, duration, delay, v]);
  return v;
}

const range = (v, from, to) => v.interpolate({ inputRange: [0, 1], outputRange: [from, to] });

/** A box with a thick outline and a hard offset shadow behind it. */
function Stacked({ width, height, color, radius, shadow = INK, children, style }) {
  const w = width - OFFSET;
  const h = height - OFFSET;
  return (
    <View style={{ width, height }}>
      <View
        style={{
          position: "absolute",
          left: OFFSET,
          top: OFFSET,
          width: w,
          height: h,
          borderRadius: radius,
          backgroundColor: shadow,
        }}
      />
      <View
        style={[
          {
            width: w,
            height: h,
            borderRadius: radius,
            backgroundColor: color,
            borderWidth: BORDER,
            borderColor: INK,
            overflow: "hidden",
          },
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

/** The scrolling graph-paper backdrop. It drifts one square and wraps, so it never seems to stop. */
function GridPaper({ width, height, animate }) {
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) return undefined;
    drift.setValue(0);
    const loop = Animated.loop(
      Animated.timing(drift, { toValue: CELL, duration: 5200, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, drift]);

  if (!(width > 0) || !(height > 0)) return null;
  const cols = Math.ceil(width / CELL) + 1;
  const rows = Math.ceil(height / CELL) + 2;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: -CELL,
        left: 0,
        width,
        height: rows * CELL,
        transform: [{ translateY: drift }],
      }}
    >
      <Svg width={width} height={rows * CELL}>
        {Array.from({ length: cols }, (_, i) => (
          <Line key={`c${i}`} x1={i * CELL} y1={0} x2={i * CELL} y2={rows * CELL} stroke={GRID} strokeWidth={2} />
        ))}
        {Array.from({ length: rows }, (_, i) => (
          <Line key={`r${i}`} x1={0} y1={i * CELL} x2={width} y2={i * CELL} stroke={GRID} strokeWidth={2} />
        ))}
      </Svg>
    </Animated.View>
  );
}

/** A small sticker that floats and turns slowly in the margins. */
function Floater({ left, top, size, color, shape, duration, delay, animate, tilt = 14 }) {
  const v = useLoop(animate, duration, delay);
  const common = {
    width: size,
    height: size,
    borderWidth: BORDER,
    borderColor: INK,
    backgroundColor: color,
  };
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left,
        top,
        transform: [{ translateY: range(v, -10, 10) }, { rotate: range(v, `-${tilt}deg`, `${tilt}deg`) }],
      }}
    >
      {shape === "circle" && <View style={[common, { borderRadius: size / 2 }]} />}
      {shape === "square" && <View style={[common, { borderRadius: size * 0.22 }]} />}
      {shape === "star" && <Ionicons name="star" size={size} color={color} style={styles.starOutline} />}
    </Animated.View>
  );
}

/** The question, as the little outlined pill that sits above each round. */
function QuestionPill({ text }) {
  return (
    <View style={styles.qPill}>
      <Ionicons name="information-circle-outline" size={moderateScale(13)} color={INK} />
      <Text style={styles.qText} numberOfLines={1}>
        {text.toUpperCase()}
      </Text>
    </View>
  );
}

/** One company on one round: logo, name, the number, whether it won, whether you picked it. */
function SideCard({ stock, valueText, isWinner, isPicked, correct, winnerTag, width, height, animate, onPress }) {
  const press = useRef(new Animated.Value(1)).current;
  const breathe = useLoop(animate && isWinner, 1300, 200);
  const bob = useLoop(animate && isPicked, 900, 100);
  const [failed, setFailed] = useState(false);
  const domain = DOMAIN_BY_KEY.get(stock.key);

  const pressTo = (to) =>
    Animated.spring(press, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  const logoSize = moderateScale(42);

  return (
    <View>
      <Animated.View
        style={{
          transform: [
            { scale: press },
            ...(isWinner ? [{ scale: range(breathe, 1, 1.035) }] : []),
          ],
        }}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={onPress}
          onPressIn={() => pressTo(0.95)}
          onPressOut={() => pressTo(1)}
          accessibilityRole="button"
          accessibilityLabel={`${stock.name}, ${valueText}${isWinner ? ", the winner" : ""}${
            isPicked ? ", your pick" : ""
          }. Opens the stock.`}
        >
          <Stacked width={width} height={height} radius={moderateScale(18)} color={isWinner ? WIN : LOSE}>
            <View style={styles.sideInner}>
              <Text style={styles.sideName} numberOfLines={2}>
                {stock.name}
              </Text>
              <View style={[styles.logoTile, { width: logoSize, height: logoSize, borderRadius: logoSize * 0.26 }]}>
                {failed || !domain ? (
                  <Text style={styles.logoFallback}>{stock.symbol.slice(0, 2).toUpperCase()}</Text>
                ) : (
                  <Image
                    source={{ uri: logoUri(domain) }}
                    style={{ width: logoSize * 0.72, height: logoSize * 0.72 }}
                    resizeMode="contain"
                    onError={() => setFailed(true)}
                  />
                )}
              </View>
              <Text
                style={[styles.sideValue, { fontSize: fontScale(valueFontSize(valueText)) }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {valueText.toUpperCase()}
              </Text>
            </View>
          </Stacked>
          {isWinner && (
            <View style={styles.winSticker} pointerEvents="none">
              <Text style={styles.winStickerText}>{winnerTag || "HIGHER"}</Text>
            </View>
          )}
        </TouchableOpacity>
      </Animated.View>

      <View style={styles.pickSlot}>
        {isPicked && (
          <Animated.View style={{ transform: [{ translateY: range(bob, 0, -3) }] }}>
            <View style={[styles.pickPill, { backgroundColor: correct ? WIN : LOSE }]}>
              <Ionicons name={correct ? "checkmark" : "close"} size={moderateScale(11)} color={INK} />
              <Text style={styles.pickText}>YOUR PICK</Text>
            </View>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

/** One full round: question pill, the category card, and both companies. */
function RoundRow({ round, anim, widths, animate, onViewStock }) {
  const { winner, picked } = sidesOf(round);
  const signed = isGrowthLabel(round.label);
  const fmt = (v) => formatValue(round.unit, v, { signed });
  const { catW, cardW, cardH } = widths;

  const word = categoryWord(round.label);
  const float = useLoop(animate, 2200 + (round.index % 3) * 300, (round.index % 5) * 180);

  return (
    <View style={styles.round}>
      <Animated.View
        style={{
          opacity: anim,
          transform: [{ translateX: range(anim, -30, 0) }],
          alignSelf: "flex-start",
          marginBottom: moderateScale(14),
        }}
      >
        <QuestionPill text={round.text} />
      </Animated.View>

      <View style={styles.rowCards}>
        <Animated.View
          style={{
            opacity: anim,
            transform: [
              { translateX: range(anim, -60, 0) },
              { translateY: range(float, 0, -4) },
              { rotate: range(float, "-1.2deg", "1.2deg") },
            ],
          }}
        >
          <Stacked width={catW} height={cardH} radius={moderateScale(18)} color={SKY} style={styles.catBox}>
            <View style={styles.catPill}>
              <Text style={styles.catText} numberOfLines={1} adjustsFontSizeToFit>
                {word}
              </Text>
            </View>
            {!!round.fiscalYear && <Text style={styles.catYear}>FY{String(round.fiscalYear).slice(-2)}</Text>}
          </Stacked>
        </Animated.View>

        {["left", "right"].map((side, i) => {
          const stock = round[side];
          const dir = i === 0 ? -1 : 1;
          return (
            <Animated.View
              key={side}
              style={{
                opacity: anim,
                transform: [
                  { scale: range(anim, 0.7, 1) },
                  { translateY: range(anim, 28, 0) },
                  { rotate: range(anim, `${dir * 6}deg`, "0deg") },
                ],
              }}
            >
              <SideCard
                stock={stock}
                valueText={fmt(side === "left" ? round.leftValue : round.rightValue)}
                isWinner={winner === side}
                isPicked={picked === side}
                correct={round.correct}
                winnerTag={round.winnerTag}
                width={cardW}
                height={cardH}
                animate={animate}
                onPress={() => onViewStock(stock)}
              />
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

/** Big outlined button, same sticker look as everything else. */
function StickerButton({ label, onPress, width, color = COBALT, textColor = INK, fill = PAPER }) {
  const press = useRef(new Animated.Value(1)).current;
  const pressTo = (to) =>
    Animated.spring(press, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Animated.View style={{ transform: [{ scale: press }] }}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onPress}
        onPressIn={() => pressTo(0.95)}
        onPressOut={() => pressTo(1)}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Stacked width={width} height={moderateScale(62)} radius={moderateScale(20)} color={color}>
          <View style={styles.btnInner}>
            <View style={[styles.btnPill, { backgroundColor: fill }]}>
              <Text style={[styles.btnText, { color: textColor }]} numberOfLines={1}>
                {label}
              </Text>
            </View>
          </View>
        </Stacked>
      </TouchableOpacity>
    </Animated.View>
  );
}

/**
 * The finished Stock Face-off.
 *
 * Graph-paper sticker-sheet look: the score badge pops in and counts up, then
 * each question lands one after another as a category card plus the two
 * companies, green for the side that won and red for the other, with a
 * "YOUR PICK" pill on the one you chose. Winners breathe, the cards and the
 * margin stickers float. Everything that loops stops when the device asks to
 * reduce motion.
 */
export default function StockFaceOffResult({ result, sector, navigation, onDone }) {
  const { score, total, rounds } = result;

  const [reduceMotion, setReduceMotion] = useState(false);
  const animate = !reduceMotion;
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((on) => alive && setReduceMotion(!!on))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const [box, setBox] = useState({ width: 0, height: 0 });

  const pop = useRef(new Animated.Value(0)).current; // badge entrance
  const count = useRef(new Animated.Value(0)).current; // 0 -> score
  const roundAnims = useRef(rounds.map(() => new Animated.Value(0))).current;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const id = count.addListener(({ value }) => setShown(Math.round(value)));
    Animated.parallel([
      Animated.sequence([
        Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 10, bounciness: 16 }),
      ]),
      // The count drives JS state, so it can't use the native driver.
      Animated.timing(count, { toValue: score, duration: 300 + score * 260, delay: 250, useNativeDriver: false }),
      Animated.sequence([
        Animated.delay(450),
        Animated.stagger(
          170,
          roundAnims.map((a) =>
            Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 9, bounciness: 10 }),
          ),
        ),
      ]),
    ]).start();
    return () => count.removeListener(id);
    // The result for a finished day never changes, so this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badgeBreath = useLoop(animate, 1500, 700);
  const headWobble = useLoop(animate, 1800, 0);
  const ringSpin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) return undefined;
    const loop = Animated.loop(
      Animated.timing(ringSpin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, ringSpin]);

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

  // Layout from the real width: [category | left | right].
  const pad = moderateScale(20);
  const innerW = Math.max(0, box.width - pad * 2);
  const catW = Math.floor(innerW * 0.29);
  const cardW = Math.floor((innerW - catW - GAP * 2) / 2);
  const cardH = Math.max(moderateScale(150), Math.round(cardW * 1.2));
  const widths = { catW, cardW, cardH };

  // One "View stock" button per company, but only when the day is one pair
  // (the same two companies every round). Cards open the stock either way.
  const unique = [];
  rounds.forEach((r) => [r.left, r.right].forEach((s) => !unique.find((u) => u.key === s.key) && unique.push(s)));
  const showButtons = unique.length > 0 && unique.length <= 2;
  const btnW = showButtons ? Math.floor((innerW - GAP * 2) / unique.length) : 0;

  return (
    <View style={styles.root} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      <GridPaper width={box.width} height={box.height} animate={animate} />

      <Floater left="3%" top="22%" size={22} color={SUN} shape="circle" duration={2600} delay={0} animate={animate} />
      <Floater left="88%" top="34%" size={26} color={PINK} shape="square" duration={3100} delay={400} animate={animate} />
      <Floater left="90%" top="58%" size={30} color={SUN} shape="star" duration={2800} delay={200} animate={animate} />
      <Floater left="2%" top="64%" size={26} color={PINK} shape="star" duration={3300} delay={900} animate={animate} tilt={20} />
      <Floater left="86%" top="82%" size={20} color={SKY} shape="circle" duration={2400} delay={600} animate={animate} />

      {box.width > 0 && (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingHorizontal: pad }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Score badge, headline on the left of it */}
          <View style={styles.top}>
            <Animated.View
              style={{
                flex: 1,
                paddingRight: moderateScale(14),
                opacity: pop,
                transform: [{ rotate: range(headWobble, "-2.5deg", "2deg") }],
              }}
            >
              <View style={styles.sectorChip}>
                <Text style={styles.sectorText}>{sector.toUpperCase()}</Text>
              </View>
              <Text style={styles.headline} accessibilityRole="header">
                {scoreHeadline(score, total).toUpperCase()}
              </Text>
            </Animated.View>

            <Animated.View
              style={{
                opacity: pop,
                transform: [
                  { scale: Animated.multiply(range(pop, 0.3, 1), range(badgeBreath, 1, 1.045)) },
                  { rotate: range(pop, "-14deg", "0deg") },
                ],
              }}
              accessible
              accessibilityLabel={`You got ${score} out of ${total} right`}
            >
              <Stacked
                width={Math.min(innerW * 0.62, moderateScale(250))}
                height={moderateScale(108)}
                radius={moderateScale(26)}
                color={LIME}
              >
                <View style={styles.badgeInner}>
                  <View style={styles.ringWrap}>
                    <Animated.View
                      style={[
                        styles.ringDash,
                        { transform: [{ rotate: ringSpin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] },
                      ]}
                    />
                    <Text style={styles.badgeScore}>{shown}</Text>
                  </View>
                  <Text style={styles.badgeLabel}>OUT OF {total}{"\n"}ARE CORRECT!</Text>
                </View>
              </Stacked>
            </Animated.View>
          </View>

          <Text style={styles.caption}>
            {answersText(score)} right today. Come back tomorrow for a new sector.
          </Text>

          {rounds.map((r, i) => (
            <RoundRow
              key={r.index}
              round={r}
              anim={roundAnims[i]}
              widths={widths}
              animate={animate}
              onViewStock={viewStock}
            />
          ))}

          {showButtons && (
            <View style={styles.btnRow}>
              {unique.map((s) => (
                <StickerButton
                  key={s.key}
                  width={btnW}
                  label={`VIEW ${s.symbol}`}
                  onPress={() => viewStock(s)}
                />
              ))}
            </View>
          )}

          <View style={styles.doneWrap}>
            <StickerButton width={innerW} label="DONE" color={SUN} onPress={onDone} />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAPER, overflow: "hidden" },
  content: {
    paddingTop: moderateScale(18),
    paddingBottom: moderateScale(72),
  },
  top: { flexDirection: "row", alignItems: "center", marginTop: moderateScale(8) },
  sectorChip: {
    alignSelf: "flex-start",
    backgroundColor: SUN,
    borderWidth: 2,
    borderColor: INK,
    borderRadius: moderateScale(8),
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(2),
    marginBottom: moderateScale(10),
  },
  sectorText: { color: INK, fontSize: fontScale(10), fontWeight: "900", letterSpacing: 0.6 },
  headline: {
    color: INK,
    fontSize: fontScale(26),
    lineHeight: fontScale(27),
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  badgeInner: { flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: moderateScale(10) },
  ringWrap: {
    width: moderateScale(70),
    height: moderateScale(70),
    alignItems: "center",
    justifyContent: "center",
  },
  ringDash: {
    position: "absolute",
    width: moderateScale(70),
    height: moderateScale(70),
    borderRadius: moderateScale(35),
    borderWidth: 4,
    borderColor: COBALT,
    borderStyle: "dashed",
  },
  badgeScore: { color: INK, fontSize: fontScale(40), fontWeight: "900", lineHeight: fontScale(44) },
  badgeLabel: {
    flex: 1,
    marginLeft: moderateScale(10),
    color: INK,
    fontSize: fontScale(12),
    lineHeight: fontScale(16),
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  caption: {
    color: INK,
    fontSize: fontScale(12),
    fontWeight: "600",
    marginTop: moderateScale(22),
    marginBottom: moderateScale(10),
  },
  round: { marginTop: moderateScale(38) },
  qPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(5),
    backgroundColor: PAPER,
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 999,
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(3),
    maxWidth: "100%",
  },
  qText: { color: INK, fontSize: fontScale(10.5), fontWeight: "900", letterSpacing: 0.2, flexShrink: 1 },
  rowCards: { flexDirection: "row", gap: GAP },
  catBox: { alignItems: "center", justifyContent: "center", paddingHorizontal: moderateScale(5) },
  catPill: {
    alignSelf: "stretch",
    backgroundColor: PAPER,
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 999,
    paddingVertical: moderateScale(8),
    alignItems: "center",
  },
  catText: { color: INK, fontSize: fontScale(11), fontWeight: "900", letterSpacing: -0.2 },
  catYear: { color: INK, fontSize: fontScale(10), fontWeight: "800", marginTop: moderateScale(8), opacity: 0.6 },
  sideInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: moderateScale(12),
    paddingHorizontal: moderateScale(8),
  },
  sideName: {
    color: INK,
    fontSize: fontScale(9.5),
    lineHeight: fontScale(11.5),
    fontWeight: "700",
    textAlign: "center",
    minHeight: fontScale(11.5) * 2,
  },
  logoTile: {
    backgroundColor: PAPER,
    borderWidth: 2,
    borderColor: INK,
    alignItems: "center",
    justifyContent: "center",
  },
  logoFallback: { color: INK, fontSize: fontScale(14), fontWeight: "900" },
  sideValue: { color: INK, fontWeight: "900", letterSpacing: -0.6, textAlign: "center", alignSelf: "stretch" },
  winSticker: {
    position: "absolute",
    top: -moderateScale(7),
    right: -moderateScale(2),
    backgroundColor: SUN,
    borderWidth: 2,
    borderColor: INK,
    borderRadius: moderateScale(7),
    paddingHorizontal: moderateScale(6),
    paddingVertical: 1,
    transform: [{ rotate: "6deg" }],
  },
  winStickerText: { color: INK, fontSize: fontScale(8.5), fontWeight: "900", letterSpacing: 0.4 },
  pickSlot: { height: moderateScale(32), marginTop: moderateScale(8), alignItems: "flex-start" },
  pickPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 999,
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(2),
  },
  pickText: { color: INK, fontSize: fontScale(9.5), fontWeight: "900", letterSpacing: 0.3 },
  btnRow: { flexDirection: "row", gap: GAP, marginTop: moderateScale(44) },
  doneWrap: { marginTop: moderateScale(26) },
  btnInner: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: moderateScale(8) },
  btnPill: {
    alignSelf: "stretch",
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 999,
    paddingVertical: moderateScale(8),
    alignItems: "center",
  },
  btnText: { fontSize: fontScale(15), fontWeight: "900", letterSpacing: 0.2 },
  starOutline: {
    textShadowColor: INK,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 1,
  },
});
