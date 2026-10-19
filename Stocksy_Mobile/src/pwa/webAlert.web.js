// Web / PWA only (Metro picks this file over webAlert.js on web).
//
// react-native-web ships Alert.alert as an empty function, so every
// confirmation, menu and error built on it (Remove stop-loss, Cancel alert,
// Delete wallet, wallet Rename/Delete menu, Google login errors...) silently
// does nothing in the PWA. This replaces it with a real dialog that honours
// the same (title, message, buttons, options) contract, including 3+ buttons,
// "cancel" / "destructive" styles and each button's onPress.
//
// Plain DOM on purpose: it does not depend on the React tree, so it works
// from any screen or service, and it needs no provider to be mounted.

import { Alert } from "react-native";

const queue = [];
let showing = false;

const COLORS = {
  card: "#FFFFFF",
  title: "#0F172A",
  body: "#475569",
  border: "#E2E8F0",
  action: "#1A56DB",
  destructive: "#DC2626",
  cancel: "#64748B",
};

function applyStyles(el, styles) {
  Object.assign(el.style, styles);
}

function buttonColor(btn) {
  if (btn.style === "destructive") return COLORS.destructive;
  if (btn.style === "cancel") return COLORS.cancel;
  return COLORS.action;
}

function showNext() {
  if (showing || queue.length === 0 || typeof document === "undefined") return;
  showing = true;
  const { title, message, buttons } = queue.shift();

  const previouslyFocused = document.activeElement;

  const overlay = document.createElement("div");
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  applyStyles(overlay, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "0",
    bottom: "0",
    zIndex: "2147483000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    boxSizing: "border-box",
    background: "rgba(15,23,42,0.5)",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  });

  const card = document.createElement("div");
  applyStyles(card, {
    width: "100%",
    maxWidth: "340px",
    background: COLORS.card,
    borderRadius: "16px",
    padding: "20px",
    boxSizing: "border-box",
    boxShadow: "0 10px 40px rgba(15,23,42,0.25)",
  });

  if (title) {
    const t = document.createElement("div");
    t.textContent = String(title);
    applyStyles(t, {
      fontSize: "16px",
      fontWeight: "700",
      color: COLORS.title,
      marginBottom: message ? "6px" : "14px",
    });
    card.appendChild(t);
  }
  if (message) {
    const m = document.createElement("div");
    m.textContent = String(message);
    applyStyles(m, {
      fontSize: "14px",
      lineHeight: "20px",
      color: COLORS.body,
      whiteSpace: "pre-wrap",
      marginBottom: "16px",
    });
    card.appendChild(m);
  }

  const row = document.createElement("div");
  const stacked = buttons.length > 2;
  applyStyles(row, {
    display: "flex",
    flexDirection: stacked ? "column" : "row",
    gap: "8px",
  });

  let closed = false;
  const close = (btn) => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    showing = false;
    try {
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    } catch (_) {}
    try {
      if (btn && typeof btn.onPress === "function") btn.onPress();
    } finally {
      showNext();
    }
  };

  const cancelBtn = buttons.find((b) => b.style === "cancel");
  const onKey = (e) => {
    if (e.key === "Escape" && cancelBtn) {
      e.stopPropagation();
      close(cancelBtn);
    }
  };
  document.addEventListener("keydown", onKey, true);

  let primaryEl = null;
  buttons.forEach((btn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = String(btn.text ?? "OK");
    applyStyles(b, {
      flex: stacked ? "none" : "1",
      minHeight: "44px", // comfortable touch target
      padding: "10px 12px",
      borderRadius: "10px",
      border: `1px solid ${btn.style === "cancel" ? COLORS.border : buttonColor(btn)}`,
      background: btn.style === "destructive" ? COLORS.destructive : "#FFFFFF",
      color: btn.style === "destructive" ? "#FFFFFF" : buttonColor(btn),
      fontSize: "14px",
      fontWeight: "600",
      fontFamily: "inherit",
      cursor: "pointer",
      WebkitTapHighlightColor: "transparent",
    });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      close(btn);
    });
    row.appendChild(b);
    if (!primaryEl && btn.style !== "cancel") primaryEl = b;
  });
  card.appendChild(row);
  overlay.appendChild(card);

  // Tapping the dim backdrop = cancel, but only when there is a cancel button
  // (a lone "OK" message must be acknowledged explicitly).
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && cancelBtn) close(cancelBtn);
  });

  document.body.appendChild(overlay);
  try {
    (primaryEl || row.firstChild).focus();
  } catch (_) {}
}

function webAlert(title, message, buttons) {
  if (typeof document === "undefined") return;
  const list =
    Array.isArray(buttons) && buttons.length > 0 ? buttons : [{ text: "OK" }];
  queue.push({ title, message, buttons: list });
  showNext();
}

try {
  Alert.alert = webAlert;
} catch (_) {
  // Alert class not extensible in this build: callers keep the old no-op.
}
