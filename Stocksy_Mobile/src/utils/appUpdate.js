export const UPDATE_STATUS = {
  NONE: "none",
  OPTIONAL: "optional",
  MANDATORY: "mandatory",
};

export function parseBuildNumber(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 ? value : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isSafeInteger(n) && n >= 1 ? n : null;
  }
  return null;
}

export function parseVersionPayload(payload) {
  const android = payload?.android;
  const latest = parseBuildNumber(android?.latestVersionCode);
  const minimum = parseBuildNumber(android?.minimumVersionCode);
  if (latest === null || minimum === null || minimum > latest) return null;
  return {
    latestVersionCode: latest,
    minimumVersionCode: minimum,
    message: typeof payload?.message === "string" ? payload.message : "",
  };
}

export function getUpdateStatus({ currentBuild, latestVersionCode, minimumVersionCode }) {
  const current = parseBuildNumber(currentBuild);
  const latest = parseBuildNumber(latestVersionCode);
  const minimum = parseBuildNumber(minimumVersionCode);
  if (current === null || latest === null || minimum === null) return UPDATE_STATUS.NONE;
  if (current < minimum) return UPDATE_STATUS.MANDATORY;
  if (current < latest) return UPDATE_STATUS.OPTIONAL;
  return UPDATE_STATUS.NONE;
}

export function isDismissed(record, latestVersionCode, now, durationMs) {
  if (!record || record.versionCode !== latestVersionCode) return false;
  const at = Number(record.at);
  return Number.isFinite(at) && now - at >= 0 && now - at < durationMs;
}