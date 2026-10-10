// Captures the browser's `beforeinstallprompt` event (Chrome, Edge, Samsung
// Internet — iOS Safari never fires it).
//
// The listener is attached at module load, not inside a React effect: the
// browser fires the event once, early, and it would be lost if React had not
// mounted yet. App.js imports this file at startup via PwaProvider.

let deferredPrompt = null;
let installed = false;
let snapshot = { hasNativePrompt: false, installed: false };
const listeners = new Set();

function emit() {
  snapshot = { hasNativePrompt: deferredPrompt !== null, installed };
  listeners.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Stop the browser's own mini-infobar; we show our own card instead.
    event.preventDefault();
    deferredPrompt = event;
    emit();
  });

  // Fires after the user finishes installing (from our button OR the browser menu).
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    emit();
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Returns a stable object between changes (required by useSyncExternalStore).
export function getSnapshot() {
  return snapshot;
}

/** Opens the browser install dialog. Resolves "accepted" | "dismissed" | "unavailable". */
export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return "unavailable";
  // A prompt event can only be used once.
  deferredPrompt = null;
  emit();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice && choice.outcome ? choice.outcome : "dismissed";
  } catch (e) {
    return "unavailable";
  }
}
