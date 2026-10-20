import React, { useMemo } from "react";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { FLAME_PATHS } from "./StreakFlame";
import { Colors } from "../theme";

// Each icon needs its own gradient ids: SVG ids are global in the browser.
let iconCount = 0;

/** The streak flame as a small, still icon (no animation). */
export default function FlameIcon({ size = 22, lit = true }) {
  const id = useMemo(() => `flameIcon${iconCount++}`, []);
  const { outer, mid, core, width, height } = FLAME_PATHS;
  const c = lit
    ? { o: [Colors.primaryAccent, Colors.primary, Colors.primaryDark], m: [Colors.primaryLight, Colors.primaryAccent], core: Colors.white }
    : { o: ["#94A3B8", "#64748B", "#475569"], m: ["#CBD5E1", "#94A3B8"], core: "#F1F5F9" };

  return (
    <Svg width={(size * width) / height} height={size} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id={`${id}o`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.o[0]} />
          <Stop offset="0.5" stopColor={c.o[1]} />
          <Stop offset="1" stopColor={c.o[2]} />
        </LinearGradient>
        <LinearGradient id={`${id}m`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.m[0]} />
          <Stop offset="1" stopColor={c.m[1]} />
        </LinearGradient>
      </Defs>
      <Path d={outer} fill={`url(#${id}o)`} />
      <Path d={mid} fill={`url(#${id}m)`} />
      <Path d={core} fill={c.core} opacity={0.92} />
    </Svg>
  );
}
