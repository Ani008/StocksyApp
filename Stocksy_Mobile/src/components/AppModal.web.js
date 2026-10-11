import React from "react";
import { Modal, View, StyleSheet } from "react-native";

import { MAX_APP_WIDTH } from "../theme/responsive";

// Same colour as the page around the app column (see WebFrame.web.js).
const PAGE_BG = "#0B0F19";

/**
 * Web only. react-native-web renders <Modal> into a portal that covers the
 * whole browser window, OUTSIDE the app column, so on a tablet or desktop a
 * bottom sheet would stretch across the full window width.
 *
 * This keeps modal content in the same phone-sized column as the app. On a
 * phone (window narrower than the column) it is a no-op.
 *
 * Drop-in: same props as react-native's Modal.
 */
export default function AppModal({ children, transparent, ...props }) {
  return (
    <Modal transparent={transparent} {...props}>
      <View
        // Transparent modals let the page show through the sides; opaque ones
        // (e.g. the full-screen chart) need the page colour, not white.
        style={[styles.outer, { backgroundColor: transparent ? "transparent" : PAGE_BG }]}
        pointerEvents="box-none"
      >
        <View style={styles.column} pointerEvents="box-none">
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    alignItems: "center",
  },
  column: {
    flex: 1,
    width: "100%",
    maxWidth: MAX_APP_WIDTH,
  },
});
