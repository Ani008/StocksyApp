// Web/PWA only. In an iOS home-screen app with
// apple-mobile-web-app-status-bar-style="default", the app is NOT drawn
// under the status bar: iOS paints that strip itself using the page's
// background colour (and softens its lower edge). If the page background
// differs from the screen's top colour, you see a dark band that fades
// into the header.
//
// Fix: keep the page background (<html>) and <meta name="theme-color">
// equal to whatever colour is at the top of the current screen.
import { Platform } from "react-native";
import { Colors } from "../theme";

// Colour at the very top edge of each screen, keyed by route name.
// The four tab screens all open with the blue hero header; Buy Order is
// pure white; every other screen uses the light app background.
// When you add a screen with a different top colour, add it here.
const TOP_COLOR_BY_ROUTE = {
  Home: Colors.primaryDark,
  Portfolio: Colors.primaryDark,
  Markets: Colors.primaryDark,
  Profile: Colors.primaryDark,
  BuyOrder: Colors.white,
};

let lastColor = null;

export function setStatusBarColor(color) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  if (color === lastColor) return;
  lastColor = color;

  document.documentElement.style.backgroundColor = color;
  document.body.style.backgroundColor = color;

  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", color);
}

export function syncStatusBarColorToRoute(routeName) {
  setStatusBarColor(TOP_COLOR_BY_ROUTE[routeName] || Colors.background);
}
