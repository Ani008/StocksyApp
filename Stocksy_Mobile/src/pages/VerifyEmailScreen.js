import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import Text from "../components/AppText";
import Button from "../components/Button";
import Input from "../components/Input";
import OtpCodeInput, { OTP_LENGTH } from "../components/OtpCodeInput";
import { SafeAreaView } from "react-native-safe-area-context";

import authService from "../../services/authService";
import {
  getPendingPassword,
  clearPendingCredentials,
} from "../../services/pendingCredentials";

import { Colors, Typography, fontScale, moderateScale } from "../theme";

const BLUE = Colors.primaryDark;
const DARK = Colors.text;
const MUTED = Colors.textSecondary;
const BG = Colors.background;
const ERROR = Colors.danger;

const RESEND_SECONDS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// VerifyEmailScreen
// Shown after signup, and after a login with the right password on an account
// whose email was never confirmed. Navigation: 'VerifyEmail', params { email }.
//
// The server needs the password the person is using (it confirms the mailbox
// AND makes sure the account ends up with the owner's password). Normally it
// is still in memory from the signup/login screen. After a page reload it is
// gone, so the screen asks for it.
// ─────────────────────────────────────────────────────────────────────────────
const VerifyEmailScreen = ({ navigation, route }) => {
  const email = String(route?.params?.email || "").trim().toLowerCase();

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [askPassword, setAskPassword] = useState(!getPendingPassword(email));
  const [loading, setLoading] = useState(false);

  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const [resendLoading, setResendLoading] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const handleVerify = async () => {
    if (code.length !== OTP_LENGTH) {
      setCodeError(`Enter all ${OTP_LENGTH} digits`);
      return;
    }

    const pw = askPassword ? password : getPendingPassword(email);
    if (!pw) {
      setPasswordError("Enter your password");
      return;
    }

    try {
      setLoading(true);
      await authService.verifyEmail({ email, code, password: pw });
      navigation.replace("MainTabs");
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === "WEAK_PASSWORD") {
        // Right code, unacceptable password: pick another and try again.
        clearPendingCredentials();
        setAskPassword(true);
        setPassword("");
        setPasswordError(data.message || "Choose a stronger password.");
      } else if (data?.code === "OTP_INVALID") {
        setCodeError(data.message || "That code is invalid or has expired.");
      }
      // Anything else is already shown by the global toast (api.js).
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || resendLoading) return;
    try {
      setResendLoading(true);
      await authService.resendVerification(email);
      setCode("");
      setCodeError("");
      setResent(true);
      setCountdown(RESEND_SECONDS);
    } catch (err) {
      // toast from api.js
    } finally {
      setResendLoading(false);
    }
  };

  const handleBack = () => {
    clearPendingCredentials();
    navigation.replace("Login");
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <Text style={styles.backArrow}>←</Text>
            <Text style={styles.backText}>Back to login</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.brand}>Stocksy</Text>
            <Text style={styles.title}>Confirm your email</Text>
            <Text style={styles.subtitle}>
              We sent a {OTP_LENGTH}-digit code to {email}.
            </Text>
          </View>

          <View style={styles.form}>
            <OtpCodeInput
              value={code}
              onChange={(v) => {
                setCode(v);
                setCodeError("");
              }}
            />
            {codeError ? <Text style={styles.errorText}>{codeError}</Text> : null}

            {askPassword ? (
              <Input
                label="Password"
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  setPasswordError("");
                }}
                placeholder="Your password"
                secureTextEntry
                error={passwordError}
              />
            ) : null}

            <View style={styles.resendRow}>
              {countdown > 0 ? (
                <Text style={styles.resendTimer}>
                  Resend in <Text style={styles.resendBlue}>{countdown}s</Text>
                </Text>
              ) : resendLoading ? (
                <ActivityIndicator size="small" color={BLUE} />
              ) : (
                <TouchableOpacity onPress={handleResend}>
                  <Text style={styles.resendLink}>
                    {resent ? "Resend code again" : "Resend code"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <Button
              title="Verify"
              onPress={handleVerify}
              loading={loading}
              style={styles.btn}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: moderateScale(24) },

  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: moderateScale(24),
    alignSelf: "flex-start",
  },
  backArrow: { fontSize: fontScale(Typography.h4), color: BLUE, marginRight: moderateScale(4) },
  backText: { fontSize: fontScale(14), color: BLUE, fontWeight: "600" },

  header: { marginBottom: moderateScale(36) },
  brand: {
    fontSize: fontScale(Typography.h1),
    fontWeight: "800",
    color: BLUE,
    letterSpacing: -0.5,
    marginBottom: moderateScale(12),
  },
  title: {
    fontSize: fontScale(26),
    fontWeight: "700",
    color: DARK,
    marginBottom: moderateScale(6),
  },
  subtitle: { fontSize: fontScale(Typography.body), color: MUTED },

  form: { marginBottom: moderateScale(24) },
  btn: { marginTop: moderateScale(8) },
  errorText: {
    fontSize: fontScale(Typography.small),
    color: ERROR,
    fontWeight: "500",
    marginBottom: moderateScale(8),
  },

  resendRow: {
    alignItems: "center",
    marginBottom: moderateScale(20),
    marginTop: moderateScale(8),
  },
  resendTimer: { fontSize: fontScale(Typography.caption), color: MUTED },
  resendBlue: { color: BLUE, fontWeight: "600" },
  resendLink: { fontSize: fontScale(Typography.caption), color: BLUE, fontWeight: "600" },
});

export default VerifyEmailScreen;
