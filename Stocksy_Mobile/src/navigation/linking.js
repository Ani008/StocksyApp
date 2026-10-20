import {
  findFocusedRoute,
  getPathFromState as defaultGetPathFromState,
  getStateFromPath as defaultGetStateFromPath,
} from "@react-navigation/native";

/*
 * WEB / PWA BACK BUTTON
 * ---------------------
 * Without a `linking` config, React Navigation on web never touches the
 * browser history. Every screen change happens at the same URL ("/"), so the
 * history has exactly one entry, and Android's Back button (or the browser
 * Back button) has nowhere to go but OUT of the app.
 *
 * With `linking` enabled, each navigation pushes a history entry. Back then
 * returns to the previous screen, and only leaves the app from the first one.
 *
 * During a session, Back/Forward restore the full saved screen state, params
 * included (React Navigation keeps it in memory against each history entry).
 * The URL itself is only used on a cold start or reload, which is why the
 * rules below exist.
 */

// Screens the person can only see signed out / signed in.
const AUTH_SCREENS = new Set(["Login", "Signup", "ForgotPassword", "VerifyEmail"]);

// Screens that crash without the params they were opened with. A URL cannot
// carry those params (we keep URLs clean, see getPathFromState), so after a
// reload these fall back to the start screen instead of an empty form.
const NEEDS_PARAMS = new Set([
  "StockDetail",
  "BuyOrder",
  "OrderSuccess",
  "VerifyEmail",
]);

const config = {
  screens: {
    Login: "login",
    Signup: "signup",
    ForgotPassword: "forgot-password",
    VerifyEmail: "verify-email",
    MainTabs: {
      path: "",
      screens: {
        Home: "",
        Portfolio: "portfolio",
        Markets: "markets",
        Profile: "profile",
      },
    },
    Wallet: "wallet",
    AllTransactions: "transactions",
    OrderHistory: "orders",
    Journal: "journal",
    Alerts: "alerts",
    Watchlist: "watchlist",
    Streak: "streak",
    Search: "search",
    StockDetail: "stock",
    BuyOrder: "order",
    OrderSuccess: "order-success",
  },
};

/**
 * @param {boolean} isAuthenticated  whether a session is active right now
 * @returns linking options for <NavigationContainer linking={...}> (web only)
 */
export function createLinking(isAuthenticated) {
  return {
    prefixes: [],
    config,

    // Keep URLs short and free of data: no prices, symbols or "[object Object]"
    // in the address bar or history.
    getPathFromState: (state, options) =>
      defaultGetPathFromState(state, options).split("?")[0],

    // Decides what a typed/reloaded URL may open. Returning undefined means
    // "start at the normal first screen" (Login, or Home when signed in).
    getStateFromPath: (path, options) => {
      const state = defaultGetStateFromPath(path, options);
      const route = state ? findFocusedRoute(state) : undefined;
      if (!route) return undefined;

      if (NEEDS_PARAMS.has(route.name)) return undefined;

      const isAuthScreen = AUTH_SCREENS.has(route.name);
      if (isAuthenticated && isAuthScreen) return undefined;
      if (!isAuthenticated && !isAuthScreen) return undefined;

      return state;
    },
  };
}
