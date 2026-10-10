import React from "react";
import { View, Image, ActivityIndicator, StyleSheet } from "react-native";

// White Stocksy mark on a transparent background.
const LOGO = require("../../assets/StocksyLogo.png");

// Web replacement for SplashVideoScreen. The 4s autoplay video is blocked or
// restricted on iOS Safari and is annoying on every PWA launch, so on web the
// splash is this static, instant-to-paint screen — shown only while the app
// works out whether the user is signed in. The background colour matches
// public/index.html so there is no white flash before it.
export default function SplashStaticScreen() {
  return (
    <View style={styles.container}>
      <Image
        source={LOGO}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Stocksy"
      />
      <ActivityIndicator
        size="small"
        color="#60A5FA"
        style={styles.spinner}
        accessibilityLabel="Loading"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0B0F19", // same as SplashVideoScreen and public/index.html
  },
  logo: { width: 112, height: 112 },
  spinner: { marginTop: 28 },
});
