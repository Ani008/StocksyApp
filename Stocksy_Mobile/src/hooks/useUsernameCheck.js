import { useCallback, useEffect, useRef, useState } from "react";

import { checkUsername } from "../../services/profileService";
import { isCheckable, normalizeUsername } from "../utils/profileSetup";

const DEBOUNCE_MS = 450;

/**
 * Live "is this username free?" for a text field (signup screen and the
 * username | avatar box).
 *
 *   status   "idle"       nothing worth checking yet (empty, or under 3 characters)
 *            "checking"   waiting for the server
 *            "available"  free to take
 *            "taken"      someone else has it
 *            "invalid"    breaks a rule — `message` says which
 *            "error"      the check itself failed (offline); NOT a verdict on the name
 *   message  what to show next to the field for taken / invalid / error
 *
 *   ensureChecked()  call on submit. Resolves true only if the CURRENT text is
 *                    confirmed available, checking right now if needed (so a
 *                    fast typist who taps Save before the delayed check ran
 *                    still gets a real answer).
 *   markTaken()      the server refused the save because the name was taken in
 *                    the meantime: show it on the field.
 *
 * Checks wait for a pause in typing, and an answer that arrives after the text
 * has changed again is thrown away, so the field never shows a verdict for a
 * name that is no longer in it.
 */
export default function useUsernameCheck(value) {
  const [state, setState] = useState({ status: "idle", message: "", checked: "" });

  const stateRef = useRef(state);
  stateRef.current = state;

  const latest = useRef("");
  const seq = useRef(0);
  const timer = useRef(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const commit = useCallback((next) => {
    if (mounted.current) setState(next);
    return next;
  }, []);

  // Asks the server about `normalized`. Resolves the new state, or null if a
  // newer check (or an edit) made this answer irrelevant.
  const run = useCallback(
    async (normalized) => {
      const id = ++seq.current;
      commit({ status: "checking", message: "", checked: normalized });
      try {
        const result = await checkUsername(normalized);
        if (id !== seq.current) return null;
        if (result?.available) {
          return commit({ status: "available", message: "", checked: result.username || normalized });
        }
        return commit({
          status: result?.reason === "TAKEN" ? "taken" : "invalid",
          message: result?.message || "That username isn't available.",
          checked: normalized,
        });
      } catch {
        if (id !== seq.current) return null;
        return commit({
          status: "error",
          message: "Couldn't check this username. Check your connection.",
          checked: normalized,
        });
      }
    },
    [commit],
  );

  useEffect(() => {
    const normalized = normalizeUsername(value);
    latest.current = normalized;
    clearTimeout(timer.current);

    if (!isCheckable(normalized)) {
      seq.current += 1; // drop any answer still on its way
      setState({ status: "idle", message: "", checked: "" });
      return undefined;
    }

    // Already answered for exactly this text (e.g. the effect re-ran on mount).
    if (stateRef.current.checked === normalized && stateRef.current.status !== "error") {
      return undefined;
    }

    seq.current += 1;
    setState({ status: "checking", message: "", checked: normalized });
    timer.current = setTimeout(() => run(normalized), DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [value, run]);

  const ensureChecked = useCallback(async () => {
    const normalized = latest.current;
    if (!normalized) return false;

    const current = stateRef.current;
    if (current.status === "available" && current.checked === normalized) return true;

    clearTimeout(timer.current);
    const result = await run(normalized);
    return result?.status === "available";
  }, [run]);

  const markTaken = useCallback(() => {
    seq.current += 1;
    commit({
      status: "taken",
      message: "That username is already taken.",
      checked: latest.current,
    });
  }, [commit]);

  return {
    status: state.status,
    message: state.message,
    ensureChecked,
    markTaken,
  };
}
