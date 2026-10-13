import React, { useState, useEffect, useRef } from "react";
import api from "../../services/api"; // Adjust the import path based on your project structure
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
} from "react-native";
import Text from "../components/AppText";
import TextInput from "../components/AppTextInput";
import Button from "../components/Button";
import OtpCodeInput, { OTP_LENGTH } from "../components/OtpCodeInput";
import Input from "../components/Input";
import { SafeAreaView } from "react-native-safe-area-context";

import { Colors, Typography, fontScale, moderateScale } from "../theme";

// ── Colors (matching existing app palette) ─────────────────────────────────
const BLUE = Colors.primaryDark;
const DARK = Colors.text;
const MUTED = Colors.textSecondary;
const BORDER = Colors.borderLight;
const BG = Colors.background;
const ERROR = Colors.danger;
const GREEN = Colors.gain;
const WHITE = Colors.white;

// ── Step constants ─────────────────────────────────────────────────────────
const STEP_EMAIL = "email";
const STEP_OTP = "otp";
const STEP_RESET = "reset";
const STEP_SUCCESS = "success";

const OTP_RESEND_SECONDS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// ForgotPasswordScreen
// Navigation: registered as 'ForgotPassword' in App.js (auth stack)
// ─────────────────────────────────────────────────────────────────────────────
const ForgotPasswordScreen = ({ navigation }) => {
  const [step, setStep] = useState(STEP_EMAIL);

  // Step 1 — email/mobile
  const [contact, setContact] = useState("");
  const [contactError, setContactError] = useState("");

  // Step 2 — OTP
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [countdown, setCountdown] = useState(OTP_RESEND_SECONDS);
  const [canResend, setCanResend] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  // Step 3 — reset
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [resetErrors, setResetErrors] = useState({});
  const [loading, setLoading] = useState(false);

  // Toast
  const toastAnim = useRef(new Animated.Value(0)).current;

  // ── OTP Countdown ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== STEP_OTP) return;
    setCountdown(OTP_RESEND_SECONDS);
    setCanResend(false);

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setCanResend(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [step]);

  // ── Toast animation ───────────────────────────────────────────────────────
  const showToast = () => {
    Animated.sequence([
      Animated.timing(toastAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.delay(2000),
      Animated.timing(toastAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => navigation.replace("Login"));
  };

  // ── Step 1: Validate email/mobile ─────────────────────────────────────────
  const handleSendOtp = async () => {
    const emailRegex = /\S+@\S+\.\S+/;

    if (!contact.trim()) {
      setContactError("Email is required");
      return;
    }

    if (!emailRegex.test(contact)) {
      setContactError("Enter a valid email");
      return;
    }

    try {
      setLoading(true);

      const response = await api.post("/auth/forgot-password/send-otp", {
        email: contact.trim().toLowerCase(),
      });

      setLoading(false);

      if (response.data.success) {
        setContactError("");
        setStep(STEP_OTP);
      }
    } catch (err) {
      setLoading(false);

      setContactError(err.response?.data?.message || "Unable to send OTP.");
    }
  };

  // ── Step 2: OTP input handlers ────────────────────────────────────────────
  const handleVerifyOtp = async () => {
    const enteredOtp = otp;

    if (enteredOtp.length !== OTP_LENGTH) {
      setOtpError(`Enter all ${OTP_LENGTH} digits`);
      return;
    }

    try {
      setLoading(true);

      const response = await api.post("/auth/forgot-password/verify-otp", {
        email: contact.trim().toLowerCase(),
        otp: enteredOtp,
      });

      setLoading(false);

      if (response.data.success) {
        setOtpError("");
        setStep(STEP_RESET);
      }
    } catch (err) {
      setLoading(false);

      setOtpError(err.response?.data?.message || "Invalid OTP.");
    }
  };

  const handleResend = async () => {
    if (!canResend || resendLoading) return;

    try {
      setResendLoading(true);

      await api.post("/auth/forgot-password/send-otp", {
        email: contact.trim().toLowerCase(),
      });

      setResendLoading(false);
      setOtp("");
      setOtpError("");
      setStep(STEP_OTP);
    } catch (err) {
      setResendLoading(false);
      setOtpError(err.response?.data?.message || "Unable to resend OTP.");
    }
  };

  // ── Step 3: Reset password ────────────────────────────────────────────────
  const handleReset = async () => {
    const errs = {};

    if (!newPass) {
      errs.newPass = "New password is required";
    } else if (newPass.length < 8) {
      errs.newPass = "Minimum 8 characters";
    }

    if (!confirmPass) {
      errs.confirmPass = "Please confirm your password";
    } else if (newPass !== confirmPass) {
      errs.confirmPass = "Passwords do not match";
    }

    setResetErrors(errs);

    if (Object.keys(errs).length) return;

    try {
      setLoading(true);

      const response = await api.post("/auth/forgot-password/reset-password", {
        email: contact.trim().toLowerCase(),
        otp,
        password: newPass,
      });

      setLoading(false);

      if (response.data.success) {
        setStep(STEP_SUCCESS);
        showToast();
      }
    } catch (err) {
      setLoading(false);

      const data = err.response?.data;
      if (data?.code === "WEAK_PASSWORD") {
        // code is still valid; let them choose another password
        setResetErrors({ newPass: data.message });
      } else if (data?.code === "OTP_INVALID") {
        // code expired or burned: back to the code step
        setOtp("");
        setOtpError(data.message || "That code is invalid or has expired.");
        setStep(STEP_OTP);
      }
      // other errors: shown by the global toast (api.js)
    }
  };

  // ── Back handler ──────────────────────────────────────────────────────────
  const handleBack = () => {
    if (step === STEP_EMAIL) {
      navigation.goBack();
      return;
    }
    if (step === STEP_OTP) {
      setStep(STEP_EMAIL);
      return;
    }
    if (step === STEP_RESET) {
      setStep(STEP_OTP);
      return;
    }
  };

  // ── Step title helpers ────────────────────────────────────────────────────
  const stepTitle = {
    [STEP_EMAIL]: "Forgot Password?",
    [STEP_OTP]: "Enter OTP",
    [STEP_RESET]: "Reset Password",
    [STEP_SUCCESS]: "All Done!",
  }[step];

  const stepSubtitle = {
    [STEP_EMAIL]: "Enter your registered email or mobile number.",
    [STEP_OTP]: `If an account exists for ${contact}, we sent a ${OTP_LENGTH}-digit code.`,
    [STEP_RESET]: "Choose a new password for your account.",
    [STEP_SUCCESS]: "Your password has been reset successfully.",
  }[step];

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
          {/* Back button */}
          {step !== STEP_SUCCESS && (
            <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
              <Text style={styles.backArrow}>←</Text>
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          )}

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.brand}>Stocksy</Text>
            <Text style={styles.title}>{stepTitle}</Text>
            <Text style={styles.subtitle}>{stepSubtitle}</Text>
          </View>

          {/* ── STEP 1: Email / Mobile ─────────────────────────────────── */}
          {step === STEP_EMAIL && (
            <View style={styles.form}>
              <Input
                label="Enter Email Id"
                value={contact}
                onChangeText={(t) => {
                  setContact(t);
                  setContactError("");
                }}
                placeholder="you@example.com"
                keyboardType="email-address"
                error={contactError}
              />
              <Button
                title="Send OTP"
                onPress={handleSendOtp}
                loading={loading}
                style={styles.btn}
              />
            </View>
          )}

          {/* ── STEP 2: OTP ───────────────────────────────────────────── */}
          {step === STEP_OTP && (
            <View style={styles.form}>
              <OtpCodeInput
                value={otp}
                onChange={(v) => {
                  setOtp(v);
                  setOtpError("");
                }}
              />
              {otpError ? (
                <Text style={styles.errorText}>{otpError}</Text>
              ) : null}

              {/* Resend row */}
              <View style={styles.resendRow}>
                {canResend ? (
                  resendLoading ? (
                    <ActivityIndicator size="small" color={BLUE} />
                  ) : (
                    <TouchableOpacity onPress={handleResend}>
                      <Text style={styles.resendLink}>Resend OTP</Text>
                    </TouchableOpacity>
                  )
                ) : (
                  <Text style={styles.resendTimer}>
                    Resend in{" "}
                    <Text style={styles.resendBlue}>{countdown}s</Text>
                  </Text>
                )}
              </View>

              <Button
                title="Verify OTP"
                onPress={handleVerifyOtp}
                loading={loading}
                style={styles.btn}
              />
            </View>
          )}

          {/* ── STEP 3: Reset Password ─────────────────────────────────── */}
          {step === STEP_RESET && (
            <View style={styles.form}>
              <Input
                label="New Password"
                value={newPass}
                onChangeText={(t) => {
                  setNewPass(t);
                  setResetErrors((e) => ({ ...e, newPass: "" }));
                }}
                placeholder="Min. 8 characters"
                secureTextEntry
                error={resetErrors.newPass}
              />
              <Input
                label="Confirm Password"
                value={confirmPass}
                onChangeText={(t) => {
                  setConfirmPass(t);
                  setResetErrors((e) => ({ ...e, confirmPass: "" }));
                }}
                placeholder="Re-enter your password"
                secureTextEntry
                error={resetErrors.confirmPass}
              />
              <Button
                title="Reset Password"
                onPress={handleReset}
                loading={loading}
                style={styles.btn}
              />
            </View>
          )}

          {/* ── STEP 4: Success placeholder (toast handles navigation) ── */}
          {step === STEP_SUCCESS && (
            <View style={styles.successBox}>
              <Text style={styles.successIcon}>✅</Text>
              <Text style={styles.successText}>Redirecting you to login…</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Success Toast ───────────────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.toast,
          {
            opacity: toastAnim,
            transform: [
              {
                translateY: toastAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              },
            ],
          },
        ]}
        pointerEvents="none"
      >
        <Text style={styles.toastText}>🎉 Password reset successfully!</Text>
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: moderateScale(24) },

  // Back button
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: moderateScale(24),
    alignSelf: "flex-start",
  },
  backArrow: { fontSize: fontScale(Typography.h4), color: BLUE, marginRight: moderateScale(4) },
  backText: { fontSize: fontScale(14), color: BLUE, fontWeight: "600" },

  // Header (mirrors LoginPage)
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

  // Form
  form: { marginBottom: moderateScale(24) },
  btn: { marginTop: moderateScale(8) },

  errorText: {
    fontSize: fontScale(Typography.small),
    color: ERROR,
    fontWeight: "500",
    marginBottom: moderateScale(8),
  },

  // Resend
  resendRow: {
    alignItems: "center",
    marginBottom: moderateScale(20),
    marginTop: moderateScale(8),
  },
  resendTimer: { fontSize: fontScale(Typography.caption), color: MUTED },
  resendBlue: { color: BLUE, fontWeight: "600" },
  resendLink: { fontSize: fontScale(Typography.caption), color: BLUE, fontWeight: "600" },

  // Success
  successBox: {
    alignItems: "center",
    paddingVertical: moderateScale(48),
  },
  successIcon: { fontSize: fontScale(64), marginBottom: moderateScale(16) },
  successText: { fontSize: fontScale(Typography.body), color: MUTED, textAlign: "center" },

  // Toast
  toast: {
    position: "absolute",
    bottom: 40,
    left: 24,
    right: 24,
    backgroundColor: GREEN,
    borderRadius: 12,
    paddingVertical: moderateScale(14),
    paddingHorizontal: moderateScale(20),
    alignItems: "center",
    shadowColor: Colors.black,
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  toastText: {
    color: WHITE,
    fontSize: fontScale(Typography.body),
    fontWeight: "600",
  },
});

export default ForgotPasswordScreen;
