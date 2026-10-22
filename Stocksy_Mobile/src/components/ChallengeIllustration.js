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

const INK = "#4C1D95"; // deep violet: sits well on the lavender card

/**
 * ChallengeIllustration — two candlesticks squaring up for a trading duel:
 * a green bull and a red bear with eyes, and a "VS" badge between them.
 * Pure vector, so it stays sharp at any size (viewBox 0 0 130 130).
 */
export default function ChallengeIllustration({ width = 130, height = 130, style }) {
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 130 130"
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <SvgGradient id="cf-green" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#6EF0CF" />
          <Stop offset="0.5" stopColor="#00D09C" />
          <Stop offset="1" stopColor="#00A87D" />
        </SvgGradient>
        <SvgGradient id="cf-red" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FF9AA2" />
          <Stop offset="0.5" stopColor="#EF4444" />
          <Stop offset="1" stopColor="#DC2626" />
        </SvgGradient>
      </Defs>

      {/* sparkles */}
      <Path d="M18 22 L20 28 L26 30 L20 32 L18 38 L16 32 L10 30 L16 28 Z" fill="#FFFFFF" fillOpacity="0.9" />
      <Path d="M112 16 L113.5 20.5 L118 22 L113.5 23.5 L112 28 L110.5 23.5 L106 22 L110.5 20.5 Z" fill="#FFFFFF" fillOpacity="0.9" />

      {/* floor shadow */}
      <Ellipse cx="65" cy="121" rx="55" ry="4.5" fill={INK} fillOpacity="0.14" />

      {/* green candle (left), leaning in */}
      <G rotation="7" origin="38, 112">
        <Line x1="38" y1="42" x2="38" y2="116" stroke="#00A87D" strokeWidth="4" strokeLinecap="round" />
        <Rect x="22" y="56" width="32" height="46" rx="8" fill="url(#cf-green)" />
        <Rect x="26" y="60" width="4.5" height="30" rx="2.25" fill="#FFFFFF" fillOpacity="0.45" />
        {/* eyes */}
        <Circle cx="38" cy="74" r="4.6" fill="#FFFFFF" />
        <Circle cx="49" cy="74" r="4.6" fill="#FFFFFF" />
        <Circle cx="39.6" cy="74.6" r="2.2" fill={INK} />
        <Circle cx="50.6" cy="74.6" r="2.2" fill={INK} />
        <Path d="M36 85 Q43.5 90 51 85" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      </G>

      {/* red candle (right), leaning in */}
      <G rotation="-7" origin="92, 112">
        <Line x1="92" y1="48" x2="92" y2="116" stroke="#DC2626" strokeWidth="4" strokeLinecap="round" />
        <Rect x="76" y="62" width="32" height="40" rx="8" fill="url(#cf-red)" />
        <Rect x="100" y="66" width="4.5" height="26" rx="2.25" fill="#FFFFFF" fillOpacity="0.4" />
        {/* eyes */}
        <Circle cx="83" cy="77" r="4.6" fill="#FFFFFF" />
        <Circle cx="94" cy="77" r="4.6" fill="#FFFFFF" />
        <Circle cx="81.4" cy="77.6" r="2.2" fill={INK} />
        <Circle cx="92.4" cy="77.6" r="2.2" fill={INK} />
        <Path d="M82 89 Q88.5 85 95 89" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      </G>

      {/* VS badge */}
      <G>
        <Circle cx="65" cy="38" r="17" fill={INK} />
        <Circle cx="65" cy="38" r="17" fill="none" stroke="#FFFFFF" strokeWidth="2.5" />
        <SvgText x="65" y="43.5" fontSize="15" fontWeight="800" fill="#FFFFFF" textAnchor="middle">
          VS
        </SvgText>
      </G>
    </Svg>
  );
}
