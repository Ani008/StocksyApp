import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { PUSH_STATE } from "../utils/push";
import { getPushState, enablePush, disablePush, prefetchPushConfig } from "../pwa/push";
import { showToast } from "../../services/uiBridge";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

// Web only. On the native apps this renders nothing.
const COPY = {
  [PUSH_STATE.OFF]: {
    icon: "notifications-outline",
    title: "Get alerts on this device",
    body: "Be told the moment a price alert hits or a limit order fills, even when Stocksy is closed.",
    action: "Turn on",
  },
  [PUSH_STATE.ON]: {
    icon: "notifications",
    title: "Notifications are on",
    body: "This device will be notified when your alerts trigger.",
    action: "Turn off",
  },
  [PUSH_STATE.BLOCKED]: {
    icon: "notifications-off-outline",
    title: "Notifications are blocked",
    body: "You blocked notifications for Stocksy. Allow them in your browser or phone settings, then come back.",
  },
  [PUSH_STATE.NEEDS_INSTALL]: {
    icon: "phone-portrait-outline",
    title: "Install Stocksy to get alerts",
    body: "On iPhone, notifications only work once Stocksy is added to your Home Screen: tap Share, then Add to Home Screen, and open it from there.",
  },
};

// Dev builds only: say WHY the card is missing instead of silently hiding it
// (production users shouldn't see setup problems).
const DEV_COPY = {
  [PUSH_STATE.UNAVAILABLE]: {
    icon: "construct-outline",
    title: "Dev: push is off on the server",
    body: "GET /api/push/public-key says enabled:false. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in the server .env, restart it, and run migration 013.",
  },
  [PUSH_STATE.UNSUPPORTED]: {
    icon: "construct-outline",
    title: "Dev: push isn't available here",
    body: "Needs a service worker on https:// or http://localhost (not http://<LAN-IP>), a browser with the Push API, and a reachable /api/push/public-key.",
  },
};

export default function PushOptInCard() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    let alive = true;
    prefetchPushConfig();
    getPushState().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);

  const onPress = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (state === PUSH_STATE.ON) {
        await disablePush();
        setState(await getPushState());
      } else {
        // Straight from the tap: the browser only shows its permission
        // prompt in response to a user gesture.
        setState(await enablePush());
      }
    } catch {
      showToast("Couldn't change notification settings. Please try again.", "error");
      setState(await getPushState());
    } finally {
      setBusy(false);
    }
  }, [busy, state]);

  const c = COPY[state] || (__DEV__ ? DEV_COPY[state] : null);
  if (Platform.OS !== "web" || !c) return null;

  return (
    <View style={styles.card}>
      <Ionicons name={c.icon} size={moderateScale(22)} color={Colors.primary} />
      <View style={styles.textCol}>
        <Text style={styles.title}>{c.title}</Text>
        <Text style={styles.body}>{c.body}</Text>
      </View>
      {c.action ? (
        <TouchableOpacity onPress={onPress} disabled={busy} style={styles.btn} accessibilityRole="button">
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.btnText}>{c.action}</Text>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(12),
    backgroundColor: Colors.surface || "#fff",
    borderRadius: moderateScale(14),
    padding: moderateScale(14),
    marginBottom: moderateScale(14),
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  textCol: { flex: 1 },
  title: { fontSize: fontScale(Typography.body), fontWeight: "700", color: Colors.text },
  body: { marginTop: 2, fontSize: fontScale(Typography.caption), color: Colors.textSecondary },
  btn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(8),
    borderRadius: moderateScale(10),
    minWidth: moderateScale(64),
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: fontScale(Typography.caption) },
});
