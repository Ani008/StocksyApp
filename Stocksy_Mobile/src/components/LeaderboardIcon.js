import React, { useMemo } from "react";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { Colors } from "../theme";

// Each icon needs its own gradient id: SVG ids are global in the browser.
let iconCount = 0;

/**
 * The leaderboard podium as a small, still icon, the sibling of FlameIcon.
 * Three bars (2nd, 1st, 3rd place) filled with the same blue gradient the
 * streak flame uses, so the two buttons on the Profile header read as a pair.
 */
export default function LeaderboardIcon({ size = 22 }) {
  const id = useMemo(() => `leaderboardIcon${iconCount++}`, []);

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={Colors.primaryAccent} />
          <Stop offset="0.5" stopColor={Colors.primary} />
          <Stop offset="1" stopColor={Colors.primaryDark} />
        </LinearGradient>
      </Defs>
      {/* 2nd place */}
      <Rect x={2} y={12} width={6} height={10} rx={1.5} fill={`url(#${id})`} />
      {/* 1st place */}
      <Rect x={9} y={4} width={6} height={18} rx={1.5} fill={`url(#${id})`} />
      {/* 3rd place */}
      <Rect x={16} y={15} width={6} height={7} rx={1.5} fill={`url(#${id})`} />
    </Svg>
  );
}
