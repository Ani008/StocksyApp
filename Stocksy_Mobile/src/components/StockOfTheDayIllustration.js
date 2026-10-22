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
} from "react-native-svg";

import { Colors } from "../theme";

const GREEN = Colors.gain;
const BLUE = "#1769AA";
const DEEP_BLUE = "#123C5A";
const GOLD = "#F5B544";
const CREAM = "#F5D7A5";

/**
 * StockOfTheDayIllustration
 * Stylized illustration inspired by the BSE building,
 * Dalal Street, Mumbai.
 *
 * Pure react-native-svg. No image assets required.
 */
export default function StockOfTheDayIllustration({
  width = 150,
  height = 140,
  style,
}) {
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 180 160"
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <SvgGradient id="bse-sky" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFF8E7" />
          <Stop offset="1" stopColor="#FDE7A5" />
        </SvgGradient>

        <SvgGradient id="bse-glass" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#75D5F2" />
          <Stop offset="0.5" stopColor="#2589C5" />
          <Stop offset="1" stopColor="#12466E" />
        </SvgGradient>

        <SvgGradient id="bse-stone" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFF0D0" />
          <Stop offset="1" stopColor="#D9A96D" />
        </SvgGradient>

        <SvgGradient id="bse-arrow" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor="#6EE7B7" />
          <Stop offset="1" stopColor="#059669" />
        </SvgGradient>
      </Defs>

      {/* Background halo */}
      <Circle cx="83" cy="72" r="65" fill="url(#bse-sky)" />

      {/* Background chart bars */}
      <G opacity="0.4">
        {[
          { x: 137, y: 66, h: 20 },
          { x: 150, y: 54, h: 25 },
          { x: 163, y: 43, h: 29 },
        ].map((bar) => (
          <G key={bar.x}>
            <Line
              x1={bar.x + 3}
              y1={bar.y - 6}
              x2={bar.x + 3}
              y2={bar.y + bar.h + 6}
              stroke={GREEN}
              strokeWidth="1.5"
            />
            <Rect
              x={bar.x}
              y={bar.y}
              width="6"
              height={bar.h}
              rx="1"
              fill={GREEN}
            />
          </G>
        ))}
      </G>

      {/* Upward market arrow */}
      <Path
        d="M116 70 L132 55 L142 62 L163 35"
        fill="none"
        stroke="url(#bse-arrow)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M151 34 L166 29 L165 45"
        fill="none"
        stroke="#059669"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Ground shadow */}
      <Ellipse
        cx="89"
        cy="148"
        rx="77"
        ry="6"
        fill={DEEP_BLUE}
        opacity="0.12"
      />

      {/* Tall BSE tower silhouette */}
      <Path
        d="M35 128 L43 42 Q44 28 56 24 L79 18 L88 24
           L88 86 L99 128 Z"
        fill="#C99660"
      />

      {/* Tower main facade */}
      <Path
        d="M31 127 L40 40 Q42 27 53 23
           L76 18 L81 23 L82 82 L94 128 Z"
        fill="url(#bse-stone)"
        stroke="#D4A46E"
        strokeWidth="1"
      />

      {/* Tower glass face */}
      <Path
        d="M50 31 L73 25 L74 82 L43 112 Z"
        fill="url(#bse-glass)"
        stroke="#F8E1BA"
        strokeWidth="2"
      />

      {/* Glass window grid */}
      <G
        stroke="#BCEBFA"
        strokeWidth="0.7"
        opacity="0.8"
      >
        {[39, 49, 59, 69, 79, 89, 99].map((y) => (
          <Line
            key={`tower-row-${y}`}
            x1="44"
            y1={y}
            x2="74"
            y2={y - 7}
          />
        ))}
        {[51, 60, 68].map((x) => (
          <Line
            key={`tower-col-${x}`}
            x1={x}
            y1="30"
            x2={x - 12}
            y2="102"
          />
        ))}
      </G>

      {/* Tower side edge */}
      <Path
        d="M76 19 L82 23 L84 85 L94 128 L86 128 L76 83 Z"
        fill="#B98250"
      />

      {/* Curved main BSE building */}
      <Path
        d="M39 126
           L49 105
           Q57 89 75 84
           L116 82
           Q137 83 147 98
           L155 126 Z"
        fill="url(#bse-stone)"
        stroke="#D4A46E"
        strokeWidth="1"
      />

      {/* Curved blue glass bands */}
      <Path
        d="M48 111 Q63 91 86 91 L125 90
           Q140 91 148 105"
        fill="none"
        stroke="#205675"
        strokeWidth="5"
      />

      <Path
        d="M44 119 Q62 99 87 99 L132 98
           Q144 100 152 112"
        fill="none"
        stroke="#205675"
        strokeWidth="4"
      />

      <Path
        d="M42 126 Q64 107 89 107 L140 107
           Q148 108 155 119"
        fill="none"
        stroke="#205675"
        strokeWidth="4"
      />

      {/* Glass highlights */}
      <Path
        d="M54 109 Q67 96 87 95 L91 95"
        fill="none"
        stroke="#8BDCF5"
        strokeWidth="1.5"
      />

      <Path
        d="M50 119 Q68 105 88 104"
        fill="none"
        stroke="#8BDCF5"
        strokeWidth="1"
      />

      {/* Front facade */}
      <Path
        d="M48 120 L153 120 L158 136 L43 136 Z"
        fill="url(#bse-stone)"
        stroke="#C99760"
        strokeWidth="0.8"
      />

      {/* Ground-floor windows */}
      <Path
        d="M55 124 L145 124 L148 134 L52 134 Z"
        fill="url(#bse-glass)"
      />

      {[69, 87, 105, 123].map((x) => (
        <Line
          key={`front-window-${x}`}
          x1={x}
          y1="124"
          x2={x - 1}
          y2="134"
          stroke="#F5D7A5"
          strokeWidth="1.5"
        />
      ))}

      {/* BSE signboard */}
      <Rect
        x="91"
        y="108"
        width="39"
        height="13"
        rx="2"
        fill="#FFF9EC"
        stroke="#D4A46E"
        strokeWidth="0.7"
      />

      <TextLabel />

      {/* Entrance */}
      <Path
        d="M87 136 V128 Q92 121 97 128 V136 Z"
        fill={DEEP_BLUE}
      />

      <Path
        d="M90 136 V129 Q92 126 94 129 V136 Z"
        fill="#3D89B8"
      />

      {/* Building steps */}
      <Path
        d="M39 136 H157 L161 140 H35 Z"
        fill="#D8B17D"
      />

      <Path
        d="M33 140 H162 L166 144 H29 Z"
        fill="#EAD0A7"
      />

      <Path
        d="M28 144 H166 L170 147 H24 Z"
        fill="#C69B68"
      />

      {/* Gold accent */}
      <Rect
        x="78"
        y="141"
        width="30"
        height="2"
        rx="1"
        fill={GOLD}
      />

      {/* Decorative sparkles */}
      <Path
        d="M23 51 V59 M19 55 H27"
        stroke={GOLD}
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      <Circle cx="29" cy="70" r="1.5" fill={GOLD} />
      <Circle cx="153" cy="91" r="1.5" fill={GREEN} />
    </Svg>
  );
}

/**
 * Small BSE sign lettering rendered as SVG text.
 * Uses a native SVG text element to keep the illustration self-contained.
 */
function TextLabel() {
  return (
    <G>
      <Path
        d="M96 111 H101 Q104 111 104 113
           Q104 115 101 115 H96 Z"
        fill={BLUE}
      />
      <Path
        d="M96 115 H102 Q105 115 105 117
           Q105 119 102 119 H96 Z"
        fill={BLUE}
      />
      <Path
        d="M108 112 H116 M108 112 V119 M108 115 H115 M108 119 H116"
        fill="none"
        stroke={BLUE}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <Path
        d="M119 112 L122 119 L125 112"
        fill="none"
        stroke={BLUE}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </G>
  );
}