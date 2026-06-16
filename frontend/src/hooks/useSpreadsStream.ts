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
}

export function useSpreadsStream(
  symbol: string,
  expiration?: string,
  selectedStrikes?: number[],
  focusRange?: { min: number; max: number },
  targetPutDelta?: number,
  targetCallDelta?: number,
  wingWidth?: number,
): UseSpreadsStreamResult {
  const [chainMap, setChainMap] = useState<Map<number, IronCondorChainStrike>>(new Map());
  const [underlyingPrice, setUnderlyingPrice] = useState(0);
  const [expirations, setExpirations] = useState<string[]>([]);
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

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

    const params = new URLSearchParams({ symbol });
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
            setChainMap(newMap);
            setUnderlyingPrice(init.underlyingPrice);
            setExpirations(init.expirations);
            setSelectedExpiration(init.selectedExpiration);
            break;
          }

          case "chain-update": {
            const update = data as ChainUpdateEvent;
            if (update.underlyingPrice !== undefined) {
              setUnderlyingPrice(update.underlyingPrice);
            }
            if (update.updates.length > 0) {
              setChainMap((prev) => {
                const next = new Map(prev);
                let changed = false;
                for (const u of update.updates) {
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
  }, [symbol, expiration, selectedStrikes, focusRange, targetPutDelta, targetCallDelta, wingWidth]);

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

  // Derive sorted chain array from Map
  const chain = useMemo(() => {
    return Array.from(chainMap.values()).sort((a, b) => a.strike - b.strike);
  }, [chainMap]);

  return {
    chain,
    underlyingPrice,
    expirations,
    selectedExpiration,
    status,
    error,
  };
}
