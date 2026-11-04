import React from "react";
import { View, Text, StyleSheet } from "react-native";

import Input from "./Input";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

/**
 * UsernameField — the username text box plus its live "available / taken"
 * line. Presentational: the parent owns the text and runs useUsernameCheck.
 *
 * Props:
 *   value, onChangeText   the text
 *   status, message       from useUsernameCheck
 *   error                 an error the parent wants shown instead (e.g.
 *                         "Username is required" after pressing Create)
 *   label                 default "Username"
 *   autoFocus
 */
const HINT = "3–20 characters: letters, numbers, . and _";

export default function UsernameField({
  value,
  onChangeText,
  status,
  message,
  error,
  label = "Username",
  autoFocus = false,
}) {
  const bad = status === "taken" || status === "invalid" || status === "error";
  const shownError = error || (bad ? message : undefined);

  let line = null;
  if (!shownError) {
    if (status === "checking") {
      line = <Text style={[styles.line, styles.muted]}>Checking…</Text>;
    } else if (status === "available") {
      line = <Text style={[styles.line, styles.ok]}>✓ Username is available</Text>;
    } else {
      line = <Text style={[styles.line, styles.muted]}>{HINT}</Text>;
    }
  }

  return (
    <View>
      <Input
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder="Choose a username"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={20}
        autoFocus={autoFocus}
        error={shownError}
        style={styles.input}
      />
      {/* A hint / result line keeps the same height whichever it is, so the form
          doesn't jump while typing. An error is drawn by Input itself, so then
          only the gap below is kept. */}
      <View style={shownError ? styles.gap : styles.lineBox}>{line}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: moderateScale(2) },
  lineBox: { minHeight: moderateScale(20), marginBottom: moderateScale(12) },
  gap: { marginBottom: moderateScale(12) },
  line: { fontSize: fontScale(Typography.small), fontWeight: "500" },
  muted: { color: Colors.textMuted },
  ok: { color: Colors.success, fontWeight: "600" },
});
