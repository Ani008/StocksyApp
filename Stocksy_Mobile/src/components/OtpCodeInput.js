import React from "react";
import { StyleSheet } from "react-native";
import TextInput from "./AppTextInput";

import { Colors, Typography, fontScale, moderateScale } from "../theme";

export const OTP_LENGTH = 6;

/**
 * One input for the e-mailed 6-digit code (used by signup verification and
 * forgot-password). A single field instead of one box per digit so pasting the
 * code and the keyboard's "code from e-mail/SMS" suggestion both work.
 *
 * Props:
 *  - value (string)            digits entered so far
 *  - onChange (func(string))   called with digits only, at most 6
 *  - autoFocus (bool)
 */
const OtpCodeInput = ({ value, onChange, autoFocus = true, style }) => (
  <TextInput
    style={[styles.input, value ? styles.inputFilled : null, style]}
    value={value}
    onChangeText={(text) => onChange(text.replace(/\D/g, "").slice(0, OTP_LENGTH))}
    keyboardType="number-pad"
    maxLength={OTP_LENGTH}
    textAlign="center"
    autoFocus={autoFocus}
    autoComplete="one-time-code"
    textContentType="oneTimeCode"
    autoCorrect={false}
    placeholder="······"
    placeholderTextColor={Colors.textMuted}
  />
);

const styles = StyleSheet.create({
  input: {
    height: 64,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    borderRadius: 10,
    fontSize: fontScale(Typography.h2),
    fontWeight: "700",
    letterSpacing: 10,
    color: Colors.text,
    backgroundColor: Colors.white,
    marginBottom: moderateScale(8),
  },
  inputFilled: {
    borderColor: Colors.primaryDark,
    backgroundColor: Colors.primaryLight,
  },
});

export default OtpCodeInput;
