import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { fetchAppFeatures } from "../../services/featureService";

// Remote on/off switches from the server, shared by every screen. One copy lives
// here in memory (no request per render); it is refreshed
//   - when a screen that needs it first opens (launch),
//   - whenever the app comes back to the foreground,
//   - on a manual pull-to-refresh (call `refresh({ force: true })`).
//
// The server decides what is allowed; this only decides what to SHOW. If the
// switches can't be fetched (offline, server down, garbled answer) we keep what
// was last shown, but hold back anything that would START something (joining,
// trading) until a good answer arrives, and show nothing new.

const OFF = {
  competition_visible: false,
  competition_registration_open: false,
  competition_enabled: false,
};

const MIN_GAP_MS = 5000; // don't refetch more often than this unless forced

let state = {
  features: OFF,
  settings: { competition_starts_at: null },
  serverOffsetMs: 0, // server clock minus phone clock, so a wrong phone clock can't skew the countdown
  loaded: false, // a fetch has finished (good or bad)
  stale: false, // the last fetch failed
};
const listeners = new Set();
let inflight = null;
let lastFetch = 0;
let appStateSub = null;

const emit = () => listeners.forEach((l) => l(state));

// Only a real `true` counts as on.
const strictFlags = (raw) => {
  const out = { ...OFF };
  for (const key of Object.keys(OFF)) out[key] = raw?.[key] === true;
  return out;
};

export function refreshAppFeatures({ force = false } = {}) {
  if (inflight) return inflight;
  if (!force && Date.now() - lastFetch < MIN_GAP_MS) return Promise.resolve(state);

  inflight = (async () => {
    try {
      const data = await fetchAppFeatures();
      const serverMs = Date.parse(data.serverTime);
      state = {
        features: strictFlags(data.features),
        settings: { competition_starts_at: data.settings?.competition_starts_at || null },
        serverOffsetMs: Number.isNaN(serverMs) ? state.serverOffsetMs : serverMs - Date.now(),
        loaded: true,
        stale: false,
      };
    } catch {
      // Keep what was last shown, but nothing that starts an action stays on.
      state = {
        ...state,
        features: {
          ...state.features,
          competition_registration_open: false,
          competition_enabled: false,
        },
        loaded: true,
        stale: true,
      };
    } finally {
      lastFetch = Date.now();
      inflight = null;
      emit();
    }
    return state;
  })();
  return inflight;
}

// One listener for the whole app: refresh when it returns to the foreground.
function ensureForegroundRefresh() {
  if (appStateSub) return;
  let last = AppState.currentState;
  appStateSub = AppState.addEventListener("change", (next) => {
    if (/inactive|background/.test(last) && next === "active") refreshAppFeatures();
    last = next;
  });
}

/** { features, settings, serverOffsetMs, loaded, stale, refresh } */
export default function useAppFeatures() {
  const [snapshot, setSnapshot] = useState(state);

  useEffect(() => {
    listeners.add(setSnapshot);
    setSnapshot(state);
    ensureForegroundRefresh();
    refreshAppFeatures();
    return () => {
      listeners.delete(setSnapshot);
    };
  }, []);

  return { ...snapshot, refresh: refreshAppFeatures };
}
