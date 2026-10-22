import React from "react";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  LinearGradient as SvgGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import { Colors } from "../theme";

// Candle palettes: same green / red family the app's floating candles use.
const GREEN = { light: "#6EF0CF", mid: Colors.gain, deep: "#00A87D" };
const RED = { light: "#FF9AA2", mid: Colors.danger, deep: Colors.dangerDark };

const INK = "#9D174D"; // deep rose: trend line + "?" so they sit well on pink

// One candle: wick spans [wickTop, wickBottom], the body sits over it.
const CANDLES = [
  { id: "c1", palette: RED, x: 14, w: 20, wickTop: 86, wickBottom: 126, bodyTop: 96, bodyBottom: 118 },
  { id: "c2", palette: GREEN, x: 44, w: 20, wickTop: 68, wickBottom: 114, bodyTop: 76, bodyBottom: 106 },
  { id: "c3", palette: RED, x: 74, w: 20, wickTop: 60, wickBottom: 102, bodyTop: 70, bodyBottom: 92 },
  { id: "c4", palette: GREEN, x: 104, w: 22, wickTop: 22, wickBottom: 88, bodyTop: 32, bodyBottom: 78 },
];

/**
 * StockQuizIllustration — a small stock-market scene drawn as an SVG:
 * four rising candlesticks, a trend line with an arrowhead, and a "?" bubble
 * for the quiz. Pure vector (no images), so it stays sharp at any size.
 *
 * It scales to whatever box you give it (viewBox 0 0 150 140), so size it with
 * `width` / `height` or `style`.
 */
export default function StockQuizIllustration({ width = 150, height = 140, style }) {
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 150 140"
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        {CANDLES.map(({ id, palette }) => (
          <SvgGradient key={id} id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={palette.light} />
            <Stop offset="0.5" stopColor={palette.mid} />
            <Stop offset="1" stopColor={palette.deep} />
          </SvgGradient>
        ))}
      </Defs>

      {/* faint chart grid */}
      {[40, 70, 100].map((y) => (
        <Line key={y} x1="6" y1={y} x2="146" y2={y} stroke="#FFFFFF" strokeOpacity="0.7" strokeWidth="1" strokeDasharray="3 5" />
      ))}

      {/* floor shadow */}
      <Ellipse cx="72" cy="130" rx="66" ry="4" fill={INK} fillOpacity="0.12" />

      {/* candles */}
      {CANDLES.map(({ id, palette, x, w, wickTop, wickBottom, bodyTop, bodyBottom }) => {
        const cx = x + w / 2;
        const bodyH = bodyBottom - bodyTop;
        return (
          <G key={id}>
            <Line x1={cx} y1={wickTop} x2={cx} y2={wickBottom} stroke={palette.deep} strokeWidth="3" strokeLinecap="round" />
            <Rect x={x} y={bodyTop} width={w} height={bodyH} rx="5" fill={`url(#${id}-body)`} />
            {/* gloss */}
            <Rect x={x + 3.5} y={bodyTop + 3} width="3.5" height={Math.max(bodyH - 9, 4)} rx="1.75" fill="#FFFFFF" fillOpacity="0.45" />
          </G>
        );
      })}

      {/* trend line climbing across the candles, with an arrowhead */}
      <Path
        d="M8 108 C34 102 52 80 76 70 S112 40 130 20"
        fill="none"
        stroke={INK}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M138 10 L140 31 L122 22 Z" fill={INK} stroke={INK} strokeWidth="2" strokeLinejoin="round" />

      {/* quiz bubble */}
      <G>
        <Circle cx="30" cy="30" r="17" fill="#FFFFFF" />
        <Circle cx="30" cy="30" r="17" fill="none" stroke={INK} strokeOpacity="0.25" strokeWidth="1.5" />
        <Path d="M22 43 L19 54 L32 46 Z" fill="#FFFFFF" />
        <SvgText x="30" y="39" fontSize="26" fontWeight="800" fill={INK} textAnchor="middle">
          ?
        </SvgText>
      </G>
    </Svg>
  );
}
