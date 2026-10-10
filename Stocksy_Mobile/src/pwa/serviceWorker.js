// Native (iOS/Android app) build: there is no service worker. The web build
// uses serviceWorker.web.js — Metro picks that file automatically on web.

export function registerServiceWorker() {
  return () => {};
}

export async function applyUpdate() {}
