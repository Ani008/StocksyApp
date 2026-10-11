import { useEffect, useRef, useSyncExternalStore } from "react";
import marketSocket from "../../services/marketSocket";

/**
 * Live prices + per-user order pushes.
 *
 * This used to open its OWN WebSocket per screen. It is now a thin view onto
 * ONE shared, lifecycle-aware socket (services/marketSocketCore.js), so:
 *   - the server sees one connection per user (it only remembers one, so
 *     per-screen sockets used to steal each other's order notifications),
 *   - reconnect / background / offline / stale-socket handling lives in one
 *     place instead of being repeated in every screen.
 * The returned shape and the callback contract are unchanged.
 *
 * @param {(msg: object) => void} [onOrderEvent] — called for any per-user
 *   order push (ORDER_FILLED, ORDER_REJECTED, RMS_SQUARE_OFF) and also with
 *   { type: "RESYNC" } after a connection gap (reconnect, or resuming after
 *   the app was in the background for a while). Pushes sent while disconnected
 *   are gone for good, so screens holding positions/wallet data should
 *   refetch on ANY call — which the existing callbacks (`() => refresh()`)
 *   already do. The toast for real order events is shown once, centrally.
 */
export default function useMarketData(onOrderEvent) {
  const { prices, isConnected, error } = useSyncExternalStore(
    marketSocket.subscribe,
    marketSocket.getSnapshot,
    marketSocket.getSnapshot,
  );

  // Latest callback without re-attaching (an inline arrow changes every render).
  const onOrderEventRef = useRef(onOrderEvent);
  useEffect(() => {
    onOrderEventRef.current = onOrderEvent;
  }, [onOrderEvent]);

  useEffect(
    () => marketSocket.attach((msg) => onOrderEventRef.current?.(msg)),
    [],
  );

  return { prices, isConnected, error };
}
