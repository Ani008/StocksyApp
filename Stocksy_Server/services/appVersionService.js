// services/appVersionService.js
//
// Builds the public "what is the latest app version?" payload that the
// mobile app compares its own installed build against.
//
//   LATEST_ANDROID_VERSION=6     newest versionCode published on Google Play
//   MINIMUM_ANDROID_VERSION=5    oldest versionCode still allowed to run
//   APP_UPDATE_MESSAGE=...       optional text shown in the update banner

const DEFAULT_MESSAGE = 'New version available.';
const MAX_MESSAGE_LENGTH = 200;

class VersionConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VersionConfigError';
  }
}

function parseVersionCode(name, raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d+$/.test(value)) {
    throw new VersionConfigError(`${name} must be a positive integer (got ${raw === undefined ? 'undefined' : JSON.stringify(raw)})`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new VersionConfigError(`${name} must be a positive integer (got ${JSON.stringify(raw)})`);
  }
  return n;
}

function readAndroidConfig(env) {
  const latestVersionCode = parseVersionCode('LATEST_ANDROID_VERSION', env.LATEST_ANDROID_VERSION);
  const minimumVersionCode = parseVersionCode('MINIMUM_ANDROID_VERSION', env.MINIMUM_ANDROID_VERSION);

  if (minimumVersionCode > latestVersionCode) {
    throw new VersionConfigError(
      `MINIMUM_ANDROID_VERSION (${minimumVersionCode}) cannot be greater than LATEST_ANDROID_VERSION (${latestVersionCode})`
    );
  }

  return { latestVersionCode, minimumVersionCode };
}

function readMessage(env) {
  const raw = typeof env.APP_UPDATE_MESSAGE === 'string' ? env.APP_UPDATE_MESSAGE.trim() : '';
  if (!raw) return DEFAULT_MESSAGE;
  return raw.slice(0, MAX_MESSAGE_LENGTH);
}

function buildVersionResponse(env = process.env) {
  return {
    android: readAndroidConfig(env),
    message: readMessage(env),
  };
}

module.exports = {
  buildVersionResponse,
  VersionConfigError,
  DEFAULT_MESSAGE,
  MAX_MESSAGE_LENGTH,
};