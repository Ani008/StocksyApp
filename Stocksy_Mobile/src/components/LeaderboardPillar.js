import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, {
  Defs,
  LinearGradient,
  Line,
  Polygon,
  Stop,
} from "react-native-svg";

import { fontScale, moderateScale } from "../theme";

// Each pillar needs its own gradient ids: SVG ids are global in the browser.
let pillarCount = 0;

// Face colours per rank. The top face catches the light (lightest), the front
// is the main colour, and the side is in shade (darkest), which is what sells
// the 3D look.
const SHADES = {
  1: {
    top: "#BFDBFE",
    front: ["#4F8FF7", "#1D4ED8"],
    side: ["#2152C9", "#173A9E"],
  },
  2: {
    top: "#CFE3FD",
    front: ["#6AA8FA", "#2F6DEB"],
    side: ["#2A5FD6", "#1E47B0"],
  },
  3: {
    top: "#DCEBFE",
    front: ["#8DBDFB", "#4A86F0"],
    side: ["#3D75E0", "#2B5CC2"],
  },
};

/**
 * One 3D podium block, drawn as a box seen from slightly above.
 *
 * It has a lit top face and a front face. The outer pillars (2nd on the left,
 * 3rd on the right) also show a shaded side face on their outer edge, like the
 * block is turned a little away from the middle.
 *
 * Props:
 *   rank    1, 2 or 3 (picks the colours and the number shown on the front)
 *   height  height of the front face
 *   side    "left" | "right" | "none": which side face to show
 */
export default function LeaderboardPillar({ rank, height, side = "none" }) {
  const [width, setWidth] = useState(0);
  const id = useMemo(() => `pillar${pillarCount++}`, []);
  const shade = SHADES[rank] || SHADES[1];

  const W = width;
  const H = moderateScale(height);
  const T = moderateScale(18); // depth of the top face
  const S = side === "none" ? 0 : moderateScale(14); // width of the side face
  const I = W * 0.1; // how far the back edge pulls in when there is no side face

  // Points for each face (see the sketch in the comments below).
  let front, top, sideFace;
  if (side === "left") {
    //  depth goes up and to the left
    front = [[S, T], [W, T], [W, T + H], [S, T + H]];
    top = [[S, T], [W, T], [W - S, 0], [0, 0]];
    sideFace = [[S, T], [S, T + H], [0, H], [0, 0]];
  } else if (side === "right") {
    //  depth goes up and to the right
    front = [[0, T], [W - S, T], [W - S, T + H], [0, T + H]];
    top = [[0, T], [W - S, T], [W, 0], [S, 0]];
    sideFace = [[W - S, T], [W - S, T + H], [W, H], [W, 0]];
  } else {
    //  straight on: a trapezoid top, no side face
    front = [[0, T], [W, T], [W, T + H], [0, T + H]];
    top = [[0, T], [W, T], [W - I, 0], [I, 0]];
    sideFace = null;
  }

  const pts = (list) => list.map(([x, y]) => `${x},${y}`).join(" ");
  const frontLeft = front[0][0];
  const frontRight = front[1][0];

  return (
    <View
      style={{ width: "100%", height: H + T }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {W > 0 && (
        <>
          <Svg width={W} height={H + T}>
            <Defs>
              <LinearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={shade.front[0]} />
                <Stop offset="1" stopColor={shade.front[1]} />
              </LinearGradient>
              <LinearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={shade.side[0]} />
                <Stop offset="1" stopColor={shade.side[1]} />
              </LinearGradient>
            </Defs>

            {sideFace && (
              <Polygon points={pts(sideFace)} fill={`url(#${id}s)`} />
            )}
            <Polygon points={pts(front)} fill={`url(#${id}f)`} />
            <Polygon points={pts(top)} fill={shade.top} />

            {/* Thin highlight along the front edge of the top face. */}
            <Line
              x1={frontLeft}
              y1={T}
              x2={frontRight}
              y2={T}
              stroke="#FFFFFF"
              strokeOpacity={0.55}
              strokeWidth={1.5}
            />
          </Svg>

          {/* Rank number printed on the front face. */}
          <View
            style={[
              styles.numberWrap,
              { left: frontLeft, width: frontRight - frontLeft, top: T },
            ]}
          >
            <Text style={styles.number}>{rank}</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  numberWrap: {
    position: "absolute",
    alignItems: "center",
    paddingTop: moderateScale(4),
    pointerEvents: "none",
  },
  // Big and bold, like the reference: the number is the pillar's main graphic.
  number: {
    fontSize: fontScale(64),
    lineHeight: fontScale(70),
    fontWeight: "900",
    color: "rgba(255,255,255,0.9)",
    textShadowColor: "rgba(15,40,120,0.35)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 5,
  },
});
