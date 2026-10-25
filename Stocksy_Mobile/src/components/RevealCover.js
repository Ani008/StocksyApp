import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet } from "react-native";

import { Colors } from "../theme";

// The native animation driver doesn't exist on web; asking for it there only logs warnings.
const NATIVE = Platform.OS !== "web";

/**
 * Colour of the screen the Stock Face-off intro expands into, and that RevealCover
 * then fades away. It is the app's own page background, so the hand-off into the
 * game looks seamless.
 */
export const QUIZ_COVER_COLOR = Colors.background;

/**
 * RevealCover — a full-screen sheet that appears at once whenever `trigger`
 * changes to a truthy value, holds for `holdMs`, then fades out slowly over
 * `fadeMs`, revealing whatever screen it sits on top of.
 *
 * Drop it as the LAST child of a screen. It lets touches through and removes
 * itself from the tree when the fade is done.
 *
 * Props:
 *   trigger   any     — change it (e.g. to Date.now()) to play the reveal
 *   color     string  — default QUIZ_COVER_COLOR
 *   holdMs    number  — default 250
 *   fadeMs    number  — default 900
 */
export default function RevealCover({ trigger, color = QUIZ_COVER_COLOR, holdMs = 250, fadeMs = 900 }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!trigger) return undefined;
    setVisible(true);
    opacity.setValue(1);
    const anim = Animated.sequence([
      Animated.delay(holdMs),
      Animated.timing(opacity, {
        toValue: 0,
        duration: fadeMs,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: NATIVE,
      }),
    ]);
    anim.start(({ finished }) => {
      if (finished) setVisible(false);
    });
    return () => anim.stop();
  }, [trigger, opacity, holdMs, fadeMs]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity }]}
    />
  );
}
