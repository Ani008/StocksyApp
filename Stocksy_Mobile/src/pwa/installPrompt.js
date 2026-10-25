
const SNAPSHOT = Object.freeze({
  hasNativePrompt: false,
  installed: false,
});

export function subscribe() {
  return () => {};
}

export function getSnapshot() {
  return SNAPSHOT;
}

export async function promptInstall() {
  return "unavailable";
}
