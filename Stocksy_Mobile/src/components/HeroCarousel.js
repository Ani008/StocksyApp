import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { moderateScale, SCREEN_WIDTH } from "../theme";
import { offsetForPage, pageFromOffset } from "../utils/carousel";

const DOT = moderateScale(7);
const DOT_ACTIVE = moderateScale(20);

/**
 * HeroCarousel — a row of cards you swipe sideways, one page at a time, with a
 * dot per page underneath showing where you are. Tapping a dot jumps to it
 * (also how desktop-web users, who can't swipe, get to the next card).
 *
 * Every child is one page. Pages are as wide as the carousel and as tall as the
 * tallest page; give a child `flex: 1` to make it fill that height. A gap of
 * `gap` separates neighbouring pages, so mid-swipe you see two distinct cards
 * with the background between them rather than one joined slab.
 *
 * Props:
 *   gap            number — space between pages (default 14)
 *   scrollEnabled  bool   — false while something inside is being dragged (the
 *                           prediction slider), so a drag can't turn into a swipe
 *   dotColor       string — colour of the dots (active is solid, others faded)
 *   onPageChange   func   — called with the page index when it changes
 */
export default function HeroCarousel({
  children,
  scrollEnabled = true,
  gap = moderateScale(14),
  dotColor = "#FFFFFF",
  onPageChange,
  style,
}) {
  const pages = React.Children.toArray(children);
  const count = pages.length;

  // Until the first layout, assume the usual phone gutters so the first frame
  // isn't empty; the real width replaces it straight away.
  const [width, setWidth] = useState(Math.max(SCREEN_WIDTH - moderateScale(40), 1));
  const scrollRef = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  // Distance from one page's left edge to the next one's.
  const pitch = width + gap;
  const [page, setPage] = useState(0);
  const pageRef = useRef(0);

  const settle = useCallback(
    (x) => {
      const next = pageFromOffset(x, pitch, count);
      if (next !== pageRef.current) {
        pageRef.current = next;
        setPage(next);
        if (onPageChange) onPageChange(next);
      }
    },
    [pitch, count, onPageChange],
  );

  // A rotation / window resize changes the page width: keep the same page in view.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ x: offsetForPage(pageRef.current, pitch, count), animated: false });
    }
  }, [pitch, count]);

  const goTo = useCallback(
    (index) => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ x: offsetForPage(index, pitch, count), animated: true });
      }
    },
    [pitch, count],
  );

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: false, // drives dot widths, which can't use the native driver
        listener: (e) => settle(e.nativeEvent.contentOffset.x),
      }),
    [scrollX, settle],
  );

  return (
    <View style={style} onLayout={(e) => setWidth(Math.max(e.nativeEvent.layout.width, 1))}>
      <ScrollView
        ref={scrollRef}
        horizontal
        // With a gap, a page is `pitch` wide, not the scroll view's width, so native
        // snaps by interval. Web (react-native-web) can only snap with pagingEnabled,
        // which puts a snap point on every page's left edge, gap included.
        pagingEnabled={Platform.OS === "web"}
        snapToInterval={Platform.OS === "web" ? undefined : pitch}
        snapToAlignment="start"
        disableIntervalMomentum
        scrollEnabled={scrollEnabled && count > 1}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.x)}
        decelerationRate="fast"
        // The cards' shadows would be clipped flat at the scroll view's edge.
        contentContainerStyle={styles.content}
        // Web: a card must not be selectable text while swiping with a mouse/finger.
        style={Platform.OS === "web" ? styles.webScroll : null}
      >
        {pages.map((child, i) => (
          <View key={child.key ?? i} style={[styles.page, { width, marginRight: i === count - 1 ? 0 : gap }]}>
            {child}
          </View>
        ))}
      </ScrollView>

      {count > 1 ? (
        <View style={styles.dots} accessibilityRole="tablist">
          {pages.map((_, i) => {
            const input = [(i - 1) * pitch, i * pitch, (i + 1) * pitch];
            const dotWidth = scrollX.interpolate({
              inputRange: input,
              outputRange: [DOT, DOT_ACTIVE, DOT],
              extrapolate: "clamp",
            });
            const opacity = scrollX.interpolate({
              inputRange: input,
              outputRange: [0.4, 1, 0.4],
              extrapolate: "clamp",
            });
            return (
              <Pressable
                key={i}
                onPress={() => goTo(i)}
                hitSlop={10}
                accessibilityRole="tab"
                accessibilityLabel={`Card ${i + 1} of ${count}`}
                aria-selected={page === i}
              >
                <Animated.View
                  style={[styles.dot, { width: dotWidth, opacity, backgroundColor: dotColor }]}
                />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: "stretch" },
  page: { flexDirection: "column" },
  webScroll: { userSelect: "none" },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: moderateScale(6),
    marginTop: moderateScale(14),
  },
  dot: { height: DOT, borderRadius: DOT / 2 },
});
