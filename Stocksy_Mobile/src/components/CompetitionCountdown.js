import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { VU } from "../constants/vuCompetition";
import { fontScale, moderateScale } from "../theme";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, "0");

/** "18 Nov, 12:00 PM" in IST, whatever the phone's time zone is. */
export function formatIst(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + IST_OFFSET_MS); // read with the UTC getters = IST wall clock
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${h12}:${pad(d.getUTCMinutes())} ${h >= 12 ? "PM" : "AM"}`;
}

/** { days, hours, minutes, seconds, done } until `targetMs`. */
export function timeLeft(targetMs, nowMs) {
  const diff = Math.max(0, targetMs - nowMs);
  const total = Math.floor(diff / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    done: diff === 0,
  };
}

/**
 * CompetitionCountdown: a box counting down to the contest start.
 *
 * Props:
 *   startsAt    ISO string, the moment the contest starts (from the server)
 *   offsetMs    server clock minus phone clock, so a wrong phone clock can't skew it
 */
export default function CompetitionCountdown({ startsAt, offsetMs = 0 }) {
  const target = Date.parse(startsAt);
  const valid = !Number.isNaN(target);
  const [now, setNow] = useState(Date.now() + offsetMs);

  useEffect(() => {
    if (!valid) return undefined;
    setNow(Date.now() + offsetMs);
    const id = setInterval(() => setNow(Date.now() + offsetMs), 1000);
    return () => clearInterval(id);
  }, [valid, offsetMs]);

  if (!valid) return null;
  const left = timeLeft(target, now);

  if (left.done) {
    return (
      <View style={styles.startedBox}>
        <Ionicons name="flash" size={moderateScale(18)} color={VU.orangeDeep} />
        <Text style={styles.startedText}>The contest has started!</Text>
      </View>
    );
  }

  const units = [
    { label: "Days", value: left.days },
    { label: "Hours", value: left.hours },
    { label: "Mins", value: left.minutes },
    { label: "Secs", value: left.seconds },
  ];
  const a11y = `Contest starts in ${left.days} days, ${left.hours} hours, ${left.minutes} minutes`;

  return (
    <LinearGradient
      colors={[VU.blueLight, VU.blue, VU.blueDeep]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.box}
      accessible
      accessibilityLabel={a11y}
    >
      <Text style={styles.heading}>Contest starts in</Text>
      <View style={styles.row}>
        {units.map((u) => (
          <View key={u.label} style={styles.tile}>
            <Text style={styles.value}>{pad(u.value)}</Text>
            <Text style={styles.unit}>{u.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.when}>{formatIst(startsAt)} IST</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 20,
    padding: moderateScale(16),
    marginTop: moderateScale(16),
    overflow: "hidden",
  },
  heading: {
    color: VU.white,
    fontSize: fontScale(13),
    fontWeight: "600",
    textAlign: "center",
    opacity: 0.9,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: moderateScale(12),
  },
  tile: {
    flex: 1,
    alignItems: "center",
    backgroundColor: VU.white,
    borderRadius: 14,
    paddingVertical: moderateScale(10),
    marginHorizontal: moderateScale(4),
  },
  value: {
    color: VU.blueDeep,
    fontSize: fontScale(24),
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  unit: {
    color: VU.orangeDeep,
    fontSize: fontScale(11),
    fontWeight: "700",
    marginTop: 2,
  },
  when: {
    color: VU.white,
    fontSize: fontScale(12),
    fontWeight: "600",
    textAlign: "center",
    marginTop: moderateScale(12),
  },
  startedBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF3E8",
    borderRadius: 16,
    paddingVertical: moderateScale(14),
    marginTop: moderateScale(16),
  },
  startedText: {
    color: VU.orangeDeep,
    fontSize: fontScale(14),
    fontWeight: "700",
    marginLeft: moderateScale(8),
  },
});
