import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  Platform,
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { navigationRef } from "./services/navigation";
import { createLinking } from "./src/navigation/linking";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import "react-native-get-random-values";

// Financial data (prices, index values, quantities) must never get cropped
// or misread — a truncated number here isn't cosmetic, it's a trust/safety
// issue for a trading app. So text scaling from the device's OS-level
// accessibility font size setting is fully locked off, app-wide, rather
// than just capped. A 1.2x cap still leaves enough slack to crop tightly
// packed numeric rows (e.g. index tickers) on larger OS accessibility text
// sizes. This matches how other trading apps (e.g. Groww) handle this.
if (Text.defaultProps == null) Text.defaultProps = {};
Text.defaultProps.allowFontScaling = false;
if (TextInput.defaultProps == null) TextInput.defaultProps = {};
TextInput.defaultProps.allowFontScaling = false;

import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { ToastProvider } from "./src/context/ToastProvider";
import ConnectionBanner from "./src/components/ConnectionBanner";
import SessionExpiredScreen from "./src/components/SessionExpiredScreen";
import ForceUpdateScreen from "./src/components/ForceUpdateScreen";
import {
  AppUpdateProvider,
  useAppUpdate,
} from "./src/context/AppUpdateProvider";
import { UPDATE_STATUS } from "./src/utils/appUpdate";
import SplashVideoScreen from "./src/components/SplashVideoScreen";
import SplashStaticScreen from "./src/components/SplashStaticScreen";
import PwaUpdateBar from "./src/components/PwaUpdateBar";
import WebFrame from "./src/components/WebFrame";
import { PwaProvider } from "./src/context/PwaProvider";
import { registerSessionExpiredHandler } from "./services/uiBridge";
import { listenForNotificationClicks } from "./src/pwa/push";
import { syncStatusBarColorToRoute } from "./src/pwa/statusBarColor";
import { parseOpenTarget } from "./src/utils/push";

// ─── Auth screens ─────────────────────────────────────────────────────────────
import LoginPage from "./src/pages/LoginPage";
import SignupPage from "./src/pages/SignupPage";

import WalletScreen from "./src/pages/WalletScreen";
import AllTransactionsPage from "./src/pages/AllTransactionsPage";
import ForgotPasswordScreen from "./src/pages/ForgotPasswordScreen";
import VerifyEmailScreen from "./src/pages/VerifyEmailScreen";
import SearchPage from "./src/pages/SearchPage";
import BuyOrderScreen from "./src/pages/Buyorderscreen";
import OrderSuccessScreen from "./src/pages/OrderSuccessScreen";

import StockDetailPage from "./src/pages/StockDetailPage";
import OrderHistoryPage from "./src/pages/OrderHistoryPage";
import JournalScreen from "./src/pages/JournalScreen";
import AlertsPage from "./src/pages/AlertsPage";
import WatchlistPage from "./src/pages/WatchlistPage";
import StreakPage from "./src/pages/StreakPage";
import DailyChallengePage from "./src/pages/DailyChallengePage";
import StockOfTheDayPage from "./src/pages/StockOfTheDayPage";
import DailyQuizIntroPage from "./src/pages/DailyQuizIntroPage";

// ─── Tab screens ──────────────────────────────────────────────────────────────
import DashboardPage from "./src/pages/DashboardPage";
import PortfolioPage from "./src/pages/PortfolioPage";
import MarketPage from "./src/pages/MarketPage";
import ProfilePage from "./src/pages/ProfilePage";

import { ExchangePage, MarketsPage } from "./src/pages/PlaceholderPages";

// ─── Token check ──────────────────────────────────────────────────────────────
import { restoreStoredSession } from "./services/authService";

// ─────────────────────────────────────────────────────────────────────────────
// Tab icon map
// ─────────────────────────────────────────────────────────────────────────────
const TAB_ICONS = {
  Home: { active: "home", inactive: "home-outline" },
  Portfolio: { active: "briefcase", inactive: "briefcase-outline" },
  Exchange: { active: "swap-horizontal", inactive: "swap-horizontal-outline" },
  Markets: { active: "bar-chart", inactive: "bar-chart-outline" },
  Profile: { active: "person", inactive: "person-outline" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bottom Tab Navigator — shown for all authenticated screens
// ─────────────────────────────────────────────────────────────────────────────
const Tab = createBottomTabNavigator();

function MainTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: "#3B82F6",
        tabBarInactiveTintColor: "#94A3B8",
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          marginBottom: 2,
        },
        tabBarStyle: {
          backgroundColor: "white",
          borderTopColor: "#F1F5F9",
          borderTopWidth: 1,
          // Custom height + explicit padding turns off React Navigation's
          // automatic safe-area handling for this tab bar — so it has to
          // be done manually here. insets.bottom is 0 on gesture-nav
          // devices, and the real 3-button nav bar height on devices
          // like the Redmi Note 11/7 — this adapts per device instead
          // of a fixed value that only happened to work on iOS.
          height: 60 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 12 + insets.bottom,
          // Shadow for iOS
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -3 },
          // Elevation for Android
          elevation: 12,
        },
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name];
          const iconName = focused ? icons.active : icons.inactive;

          return <Ionicons name={iconName} size={22} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={DashboardPage} />
      <Tab.Screen name="Portfolio" component={PortfolioPage} />
      <Tab.Screen name="Markets" component={MarketPage} />
      <Tab.Screen name="Profile" component={ProfilePage} />
    </Tab.Navigator>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root Stack — Login/Signup sit outside the tab navigator so the tab bar
// never appears on auth screens. navigation.replace('MainTabs') after login
// removes auth screens from the stack entirely.
// ─────────────────────────────────────────────────────────────────────────────
const Stack = createNativeStackNavigator();

const IS_WEB = Platform.OS === "web";

// Web only: shortest time the static splash stays up, so it doesn't just
// flicker when the token check finishes almost instantly.
const WEB_SPLASH_MIN_MS = 600;

function AppContent() {
  // Video splash plays first, on every cold launch, regardless of auth
  // state — this is intentionally checked before isAuthenticated so it
  // shows even for already-logged-in users, not just first-time/logged-out
  // ones.
  //
  // Not on web: iOS Safari blocks/restricts autoplay video and a 4s splash
  // on every PWA launch is annoying, so web gets a static splash instead
  // (see SplashStaticScreen below).
  const [showSplashVideo, setShowSplashVideo] = useState(!IS_WEB);
  const [webSplashElapsed, setWebSplashElapsed] = useState(!IS_WEB);

  useEffect(() => {
    if (!IS_WEB) return undefined;
    const id = setTimeout(() => setWebSplashElapsed(true), WEB_SPLASH_MIN_MS);
    return () => clearTimeout(id);
  }, []);

  // null = still checking, true = has token, false = no token
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Web push: tapping a notification opens the app at /?open=alerts (cold
  // start) or sends a message to the already-open page. Both end up here.
  // A target is only acted on once the person is signed in and navigation is
  // ready; otherwise it is kept until then.
  const pendingTarget = useRef(
    IS_WEB && typeof window !== "undefined" ? parseOpenTarget(window.location.search) : null,
  );
  const authedRef = useRef(false);
  authedRef.current = isAuthenticated === true && !sessionExpired;

  const openPendingTarget = useCallback(() => {
    const target = pendingTarget.current;
    if (!target || !authedRef.current || !navigationRef.isReady()) return;
    pendingTarget.current = null;
    navigationRef.navigate(target);
    // Drop "?open=..." from the address bar. Keep the existing history state:
    // React Navigation stores its entry id there, and wiping it breaks Back.
    if (IS_WEB) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!IS_WEB) return undefined;
    return listenForNotificationClicks((target) => {
      pendingTarget.current = target;
      openPendingTarget();
    });
  }, [openPendingTarget]);

  useEffect(() => {
    // Runs in parallel with the splash video (not after it) — by the
    // time the ~4s video finishes, this has almost always already
    // resolved, so there's no extra spinner flash once the splash
    // video hands off to the real app.
    const checkToken = async () => {
      // Web: asks the server whether the httpOnly cookie still holds a live
      // session (the access token is memory-only, so a reload loses it).
      // Native: signed in if a stored session exists.
      setIsAuthenticated(await restoreStoredSession());
    };
    checkToken();
  }, []);

  // Registered once — api.js's interceptor calls triggerSessionExpired()
  // from outside the React tree whenever any request comes back 401
  // SESSION_EXPIRED. This is the only place that reacts to it.
  useEffect(() => {
    registerSessionExpiredHandler(() => setSessionExpired(true));
  }, []);

  const handleReLogin = () => {
    // Token's already cleared by the interceptor at the point of
    // failure. Flipping both flags here forces a full remount of the
    // NavigationContainer below with initialRouteName freshly
    // evaluated as "Login" — same mechanism the app already uses for
    // the normal logged-out state.
    setSessionExpired(false);
    setIsAuthenticated(false);
  };

  // Web only: ties screens to browser history so the Android/browser Back
  // button goes to the previous screen instead of leaving the PWA. Native
  // keeps `undefined` (no change). Must stay above the early returns below.
  const linking = useMemo(
    () => (IS_WEB ? createLinking(isAuthenticated === true) : undefined),
    [isAuthenticated],
  );

  if (showSplashVideo) {
    return <SplashVideoScreen onFinish={() => setShowSplashVideo(false)} />;
  }

  // ── Splash / loading state ──────────────────────────────────────────────────
  // Web: static splash until the token check is done (and the minimum
  // display time has passed).
  if (IS_WEB && (isAuthenticated === null || !webSplashElapsed)) {
    return <SplashStaticScreen />;
  }

  // Shown for the fraction of a second while SecureStore is read.
  // Prevents a flash of the Login screen for already-logged-in users.
  if (isAuthenticated === null) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  if (sessionExpired) {
    return (
      <SafeAreaProvider>
        <SessionExpiredScreen onLoginPress={handleReLogin} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ToastProvider>
        <NavigationContainer
          ref={navigationRef}
          linking={linking}
          // Keep the tab title as "Stocksy" (linking would rename it per screen).
          documentTitle={{ enabled: false }}
          onReady={() => {
            syncStatusBarColorToRoute(navigationRef.getCurrentRoute()?.name);
            openPendingTarget();
          }}
          onStateChange={() =>
            syncStatusBarColorToRoute(navigationRef.getCurrentRoute()?.name)
          }
        >
          <StatusBar style="auto" />
          <Stack.Navigator
            initialRouteName={isAuthenticated ? "MainTabs" : "Login"}
            screenOptions={{ headerShown: false }}
          >
            {/* ── Auth screens (no tab bar) ──────────────────────────────────── */}
            <Stack.Screen name="Login" component={LoginPage} />
            <Stack.Screen name="Signup" component={SignupPage} />
            <Stack.Screen
              name="ForgotPassword"
              component={ForgotPasswordScreen}
            />
            <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />

            {/* ── Authenticated shell (tab bar lives inside here) ────────────── */}
            <Stack.Screen name="MainTabs" component={MainTabs} />
            <Stack.Screen name="Wallet" component={WalletScreen} />
            <Stack.Screen
              name="AllTransactions"
              component={AllTransactionsPage}
            />
            <Stack.Screen name="OrderHistory" component={OrderHistoryPage} />
            <Stack.Screen name="Journal" component={JournalScreen} />
            <Stack.Screen name="Alerts" component={AlertsPage} />
            <Stack.Screen name="Watchlist" component={WatchlistPage} />
            <Stack.Screen name="Streak" component={StreakPage} />
            <Stack.Screen
              name="DailyChallenge"
              component={DailyChallengePage}
            />
            <Stack.Screen name="StockOfTheDay" component={StockOfTheDayPage} />
            <Stack.Screen
              name="DailyQuiz"
              component={DailyQuizIntroPage}
              options={{ animation: "fade" }}
            />

            <Stack.Screen name="Search" component={SearchPage} />
            <Stack.Screen name="StockDetail" component={StockDetailPage} />
            <Stack.Screen
              name="BuyOrder"
              component={BuyOrderScreen}
              options={{
                gestureEnabled: false,
                fullScreenGestureEnabled: false,
              }}
            />
            <Stack.Screen name="OrderSuccess" component={OrderSuccessScreen} />
          </Stack.Navigator>
        </NavigationContainer>
        <ConnectionBanner />
      </ToastProvider>
    </SafeAreaProvider>
  );
}


function UpdateGate({ children }) {
  const { status } = useAppUpdate();
  if (status === UPDATE_STATUS.MANDATORY) {
    return <ForceUpdateScreen />;
  }
  return children;
}

export default function App() {
  return (
    <PwaProvider>
      {/* WebFrame keeps the app a phone-sized column on wide web screens and
          is a pass-through on native. PwaUpdateBar renders nothing on native
          and when no web update is waiting, so the app layout is unchanged in
          those cases. */}
      <WebFrame>
        <View style={styles.root}>
          <PwaUpdateBar />
          <AppUpdateProvider>
            <UpdateGate>
              <AppContent />
            </UpdateGate>
          </AppUpdateProvider>
        </View>
      </WebFrame>
    </PwaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  splash: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
});
