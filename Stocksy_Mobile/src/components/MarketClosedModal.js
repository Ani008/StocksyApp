import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import Modal from "./AppModal";
import { Ionicons } from "@expo/vector-icons";

import { Colors, Typography, fontScale, moderateScale } from "../theme";

/**
 * MarketClosedModal
 *
 * The message box shown on the Buy/Sell order screen whenever the market
 * is closed — weekends, NSE/BSE holidays, or simply outside 9:15–15:30 IST.
 * Backed by GET /api/market/status and the MARKET_CLOSED error payload
 * from POST /api/orders (utils/errors.js on the server), both of which
 * share the same { reason, nextOpen } shape.
 *
 * Props:
 * @param {boolean}  visible
 * @param {function} onClose
 * @param {{type: string, label: string}|null} reason
 * @param {{dateLabel: string, timeLabel: string}|null} nextOpen
 */
const REASON_COPY = {
  WEEKEND: "The market is closed for the weekend.",
  HOLIDAY: "The market is closed today for a trading holiday.",
  BEFORE_HOURS: "The market hasn't opened yet today.",
  AFTER_HOURS: "The market has closed for the day.",
};

const MarketClosedModal = ({ visible, onClose, reason, nextOpen }) => {
  const reasonLine = reason?.type
    ? REASON_COPY[reason.type] || "The market is currently closed."
    : "The market is currently closed.";

  const holidayLine =
    reason?.type === "HOLIDAY" && reason.label ? ` (${reason.label})` : "";

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="time-outline" size={30} color={Colors.warning} />
          </View>

          <Text style={styles.title}>Market is Closed</Text>

          <Text style={styles.body}>
            {reasonLine}
            {holidayLine} Orders will be executed when the market opens on{" "}
            <Text style={styles.highlight}>{nextOpen?.dateLabel || "the next trading day"}</Text>{" "}
            at <Text style={styles.highlight}>{nextOpen?.timeLabel || "9:15 AM"}</Text>.
          </Text>

          <TouchableOpacity style={styles.button} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.buttonText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: moderateScale(24),
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: moderateScale(24),
    alignItems: "center",
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.warningBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: moderateScale(14),
  },
  title: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
    marginBottom: moderateScale(8),
  },
  body: {
    fontSize: fontScale(Typography.body),
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 21,
    marginBottom: moderateScale(20),
  },
  highlight: {
    fontWeight: "700",
    color: Colors.text,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: moderateScale(13),
    paddingHorizontal: moderateScale(32),
    alignItems: "center",
  },
  buttonText: {
    color: Colors.white,
    fontSize: fontScale(Typography.body),
    fontWeight: "700",
  },
});

export default MarketClosedModal;