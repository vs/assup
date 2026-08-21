import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { getApiBase } from "@/lib/apiConfig";
import type {
  IronCondorChainStrike,
  IronCondorChainOption,
  SpreadStreamInitEvent,
  ChainUpdateEvent,
  StreamErrorEvent,
} from "@assup/shared";

type StreamStatus = "connecting" | "connected" | "error" | "reconnecting";

interface UseSpreadsStreamResult {
  chain: IronCondorChainStrike[];
  underlyingPrice: number;
  expirations: string[];
  selectedExpiration: string | null;
  status: StreamStatus;
  error: string | null;
  refocusedCount: number;
  /** true while backend is in scout phase — auto-select should wait */
  scouting: boolean;
  reconnect: () => void;
}

export function useSpreadsStream(
  symbol: string,
  expiration?: string,
  selectedStrikes?: number[],
  focusRange?: { min: number; max: number },
  targetPutDelta?: number,
  targetCallDelta?: number,
  wingWidth?: number,
  mode?: string,
  updateIntervalMs = 2000,
  enabled = true,
  strikeRangePct?: number,
): UseSpreadsStreamResult {
  const [chainMap, setChainMap] = useState<Map<number, IronCondorChainStrike>>(new Map());
  const [underlyingPrice, setUnderlyingPrice] = useState(0);
  const [expirations, setExpirations] = useState<string[]>([]);
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [refocusedCount, setRefocusedCount] = useState(0);
  const [scouting, setScouting] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  // Stable client ID so the backend can destroy the previous session on reconnect
  const clientIdRef = useRef(`c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  // Serialize focusRange for stable dependency comparison — triggers reconnect
  // when the user selects legs so the backend subscribes densely around them.
  const focusRangeKey = focusRange ? `${focusRange.min}:${focusRange.max}` : "";

  // Throttle: accumulate chain-update events and flush at updateIntervalMs
  const pendingUpdatesRef = useRef<
    Map<string, ChainUpdateEvent["updates"][number]>
  >(new Map());
  const pendingUnderlyingRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Don't connect when disabled (e.g. builder not activated yet)
    if (!enabled) {
      setStatus("connecting");
      return;
    }

    const params = new URLSearchParams({ symbol, clientId: clientIdRef.current });
    if (expiration) params.set("expiration", expiration);
    if (selectedStrikes && selectedStrikes.length > 0) {
      params.set("strikes", selectedStrikes.join(","));
    }
    if (focusRange) {
      params.set("focusMin", String(focusRange.min));
      params.set("focusMax", String(focusRange.max));
    }
    if (targetPutDelta != null) params.set("targetPutDelta", String(targetPutDelta));
    if (targetCallDelta != null) params.set("targetCallDelta", String(targetCallDelta));
    if (wingWidth != null) params.set("wingWidth", String(wingWidth));
    if (mode) params.set("mode", mode);
    if (strikeRangePct != null) params.set("strikeRangePct", String(strikeRangePct));
    const url = `${getApiBase()}/api/spreads/stream?${params}`;

    setStatus("connecting");
    setError(null);

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus("connected");
      reconnectAttemptRef.current = 0;
    };

    es.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const { type, data } = message;

        switch (type) {
          case "init": {
            const init = data as SpreadStreamInitEvent;
            const newMap = new Map<number, IronCondorChainStrike>();
            for (const entry of init.chain) {
              newMap.set(entry.strike, entry);
            }
            // Clear any stale pending updates from previous session
            pendingUpdatesRef.current.clear();
            pendingUnderlyingRef.current = null;
            setChainMap(newMap);
            setUnderlyingPrice(init.underlyingPrice);
            setExpirations(init.expirations);
            setSelectedExpiration(init.selectedExpiration);
            setScouting(init.scouting ?? false);
            break;
          }

          case "chain-update": {
            const update = data as ChainUpdateEvent;
            if (update.underlyingPrice !== undefined) {
              pendingUnderlyingRef.current = update.underlyingPrice;
            }
            // Accumulate updates — latest value per strike:right wins
            for (const u of update.updates) {
              const key = `${u.strike}:${u.right}`;
              const existing = pendingUpdatesRef.current.get(key);
              pendingUpdatesRef.current.set(key, existing ? {
                ...existing,
                ...u,
                // Only overwrite fields that are present in this tick
                ...(u.bid !== undefined && { bid: u.bid }),
                ...(u.ask !== undefined && { ask: u.ask }),
                ...(u.mid !== undefined && { mid: u.mid }),
                ...(u.delta !== undefined && { delta: u.delta }),
                ...(u.iv !== undefined && { iv: u.iv }),
                ...(u.last !== undefined && { last: u.last }),
              } : u);
            }
            break;
          }

          case "refocused": {
            // Backend transitioned to dense focused subscription —
            // signal parent to re-run auto-select with more accurate delta data
            setScouting(false);
            setRefocusedCount((c) => c + 1);
            break;
          }

          case "error": {
            const err = data as StreamErrorEvent;
            setError(err.message);
            if (!err.recoverable) {
              setStatus("error");
            }
            break;
          }
        }
      } catch {
        // Ignore parse errors (keepalives, malformed messages)
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setStatus("reconnecting");

      // Exponential backoff: 1s, 2s, 4s, 8s, capped at 30s, with jitter
      const attempt = reconnectAttemptRef.current++;
      const baseDelay = Math.min(1000 * Math.pow(2, attempt), 30000);
      const jitter = Math.random() * baseDelay * 0.1;
      const delay = baseDelay + jitter;

      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };
  // Note: wingWidth intentionally excluded — it's a hint for the backend's focus.
  // focusRangeKey triggers reconnect when user selects legs so the backend
  // subscribes densely around the chosen strikes. focusRange is read in the
  // closure but keyed by focusRangeKey to avoid reconnects from object identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, expiration, selectedStrikes, focusRangeKey, targetPutDelta, targetCallDelta, mode, enabled, strikeRangePct]);

  // Connect on mount and when params change
  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);

  // Tab visibility handling
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
      } else {
        reconnectAttemptRef.current = 0;
        connect();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [connect]);

  // Periodic flush: apply accumulated chain updates to React state
  useEffect(() => {
    const interval = setInterval(() => {
      const hasPending = pendingUpdatesRef.current.size > 0;
      const hasUnderlying = pendingUnderlyingRef.current !== null;
      if (!hasPending && !hasUnderlying) return;

      if (hasUnderlying) {
        setUnderlyingPrice(pendingUnderlyingRef.current!);
        pendingUnderlyingRef.current = null;
      }

      if (hasPending) {
        const batch = pendingUpdatesRef.current;
        pendingUpdatesRef.current = new Map();

        setChainMap((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const [, u] of batch) {
            const existing = next.get(u.strike);
            if (!existing) continue;
            const side = u.right === "P" ? "put" : "call";
            const opt = existing[side];
            if (!opt) continue;
            const updated: IronCondorChainOption = {
              ...opt,
              ...(u.bid !== undefined && { bid: u.bid }),
              ...(u.ask !== undefined && { ask: u.ask }),
              ...(u.mid !== undefined && { mid: u.mid }),
              ...(u.delta !== undefined && { delta: u.delta }),
              ...(u.iv !== undefined && { iv: u.iv }),
              ...(u.last !== undefined && { last: u.last }),
            };
            next.set(u.strike, { ...existing, [side]: updated });
            changed = true;
          }
          return changed ? next : prev;
        });
      }
    }, Math.max(100, updateIntervalMs));

    return () => clearInterval(interval);
  }, [updateIntervalMs]);

  // Derive sorted chain array from Map
  const chain = useMemo(() => {
    return Array.from(chainMap.values()).sort((a, b) => a.strike - b.strike);
  }, [chainMap]);

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    connect();
  }, [connect]);

  return {
    chain,
    underlyingPrice,
    expirations,
    selectedExpiration,
    status,
    error,
    refocusedCount,
    scouting,
    reconnect,
  };
}
