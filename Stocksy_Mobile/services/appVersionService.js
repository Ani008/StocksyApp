import axios from "axios";
import { API_BASE_URL } from "../src/config/env";
import { FAST_TEST_MODE, VERSION_REQUEST_TIMEOUT_MS } from "../src/config/appUpdate";
import { parseVersionPayload } from "../src/utils/appUpdate";

// Bare axios on purpose: the shared `api` client attaches the JWT and shows a
// red error toast on failure, which is wrong for a silent background check.
// Resolves to { latestVersionCode, minimumVersionCode, message } or null. Never throws.
export async function fetchAppVersionInfo() {
  if (!API_BASE_URL) {
    console.log("[appUpdate] fetch: API_BASE_URL is empty (EXPO_PUBLIC_API_BASE_URL not set in this bundle)");
    return null;
  }
  const url = `${API_BASE_URL}/app/version`;
  try {
    console.log("[appUpdate] fetch: GET", url);
    const res = await axios.get(url, {
      timeout: VERSION_REQUEST_TIMEOUT_MS,
      headers: {
        Accept: "application/json",
        // The server sends Cache-Control: max-age=60, and the phone's network
        // stack would otherwise serve the old answer for up to a minute.
        ...(FAST_TEST_MODE ? { "Cache-Control": "no-cache" } : {}),
      },
    });
    console.log("[appUpdate] fetch: HTTP", res.status, "body:", JSON.stringify(res.data));
    const parsed = parseVersionPayload(res.data);
    if (!parsed) {
      console.log("[appUpdate] fetch: body did not match { android: { latestVersionCode, minimumVersionCode }, message }");
    }
    return parsed;
  } catch (e) {
    console.log(
      "[appUpdate] fetch FAILED:",
      e?.message,
      e?.response ? `HTTP ${e.response.status} ${JSON.stringify(e.response.data)}` : "(no response: server unreachable from the phone, or wrong IP/port)",
    );
    return null;
  }
}