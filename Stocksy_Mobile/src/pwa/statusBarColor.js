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

// Screens whose top edge is the blue hero header. Everything else has a
// light top edge.
const BLUE_TOP_ROUTES = new Set(["Home"]);

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
  setStatusBarColor(
    BLUE_TOP_ROUTES.has(routeName) ? Colors.primaryDark : Colors.background,
  );
}
