import axios from "axios";
import { API_BASE_URL } from "../src/config/env";
import { VERSION_REQUEST_TIMEOUT_MS } from "../src/config/appUpdate";
import { parseVersionPayload } from "../src/utils/appUpdate";

// Bare axios on purpose: the shared `api` client attaches the JWT and shows a
// red error toast on failure, which is wrong for a silent background check.
// Resolves to { latestVersionCode, minimumVersionCode, message } or null. Never throws.
export async function fetchAppVersionInfo() {
  if (!API_BASE_URL) return null;
  try {
    const res = await axios.get(`${API_BASE_URL}/app/version`, {
      timeout: VERSION_REQUEST_TIMEOUT_MS,
      headers: { Accept: "application/json" },
    });
    return parseVersionPayload(res.data);
  } catch (e) {
    console.log("[appUpdate] version check skipped:", e?.message);
    return null;
  }
}