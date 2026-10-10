// Native (iOS/Android app) build: nothing to install. The web build uses
// installPrompt.web.js — Metro picks that file automatically on web.

export function subscribe() {
  return () => {};
}

export function getSnapshot() {
  return { hasNativePrompt: false, installed: false };
}

export async function promptInstall() {
  return "unavailable";
}
