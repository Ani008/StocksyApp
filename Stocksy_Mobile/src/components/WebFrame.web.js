import React from "react";
import { View, StyleSheet, useWindowDimensions } from "react-native";

import { MAX_APP_WIDTH } from "../theme/responsive";

// Page colour around the column. Matches index.html's background so there is
// no seam while the bundle loads.
const PAGE_BG = "#0B0F19";
const APP_BG = "#F8FAFC";

/**
 * Web only. Keeps the app a phone-sized column.
 *
 * - Phones (window narrower than the column): fills the window, identical to
 *   having no frame at all.
 * - Tablets / desktops: a centred column of MAX_APP_WIDTH on the page colour.
 *
 * `overflow: hidden` + the frame being the positioning context means anything
 * absolutely positioned inside the app (toasts, banners, update bar) stays
 * inside the column instead of spanning the whole window.
 */
export default function WebFrame({ children }) {
  const { width } = useWindowDimensions();
  const isWide = width > MAX_APP_WIDTH + 16;

  return (
    <View style={styles.page}>
      <View style={[styles.frame, isWide && styles.frameWide]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: "center",
    backgroundColor: PAGE_BG,
  },
  frame: {
    flex: 1,
    width: "100%",
    maxWidth: MAX_APP_WIDTH,
    overflow: "hidden",
    position: "relative",
    backgroundColor: APP_BG,
  },
  frameWide: {
    boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 12px 48px rgba(0,0,0,0.5)",
  },
});
