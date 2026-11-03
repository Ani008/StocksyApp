import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text } from "react-native";

/**
 * A number that counts up from 0 to `value`, starting after `delay`.
 *
 * Props:
 *   value     the number to land on
 *   delay     ms to wait before counting starts
 *   duration  ms the count takes
 *   style     Text style
 *
 * Counting changes the text every frame, so it runs on the JS driver (the
 * native driver can't update text). It is only used for a few small numbers.
 */
export default function CountUpText({ value = 0, delay = 0, duration = 1000, style }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    progress.setValue(0);
    setShown(0);

    const id = progress.addListener(({ value: p }) => {
      setShown(Math.round(p * value));
    });
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic), // fast at first, settles on the final number
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished) setShown(value); // make sure it lands exactly on the value
    });

    return () => {
      animation.stop();
      progress.removeListener(id);
    };
  }, [value, delay, duration, progress]);

  // Equal-width digits so the text doesn't jitter while the number changes.
  return <Text style={[style, { fontVariant: ["tabular-nums"] }]}>{shown}</Text>;
}
