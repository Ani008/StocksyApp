// Native (iOS/Android app) build: web push doesn't apply. The web build uses
// push.web.js — Metro picks that file automatically on web.
import { PUSH_STATE } from "../utils/push";

export async function getPushState() {
  return PUSH_STATE.UNSUPPORTED;
}
export function prefetchPushConfig() {}
export async function enablePush() {
  return PUSH_STATE.UNSUPPORTED;
}
export async function disablePush() {}
export async function syncExistingSubscription() {}
export function listenForNotificationClicks() {
  return () => {};
}
