import { useState, useEffect, useRef, useCallback } from "react";
import { getApiBase } from "@/lib/apiConfig";

interface StrikeQuote {
  strike: number;
  right: "P" | "C";
  conId: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  delta: number | null;
}

interface UseHedgeStreamResult {
  quotes: Map<string, StrikeQuote>;
  underlyingPrice: number;
  connected: boolean;
}

/**
 * Opens a focused SSE stream for a small set of strikes.
 * Used by the hedge wizard to get live quotes for candidate hedge legs.
 */
export function useHedgeStream(
  symbol: string,
  expiration: string,
  strikes: number[],
  enabled: boolean,
): UseHedgeStreamResult {
  const [quotes, setQuotes] = useState<Map<string, StrikeQuote>>(new Map());
  const [underlyingPrice, setUnderlyingPrice] = useState(0);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const pendingRef = useRef<Map<string, Partial<StrikeQuote>>>(new Map());

  const strikesKey = strikes.sort((a, b) => a - b).join(",");

  const connect = useCallback(() => {
    if (!enabled || !expiration || strikes.length === 0) return;

    const params = new URLSearchParams({
      symbol,
      expiration,
      strikes: strikesKey,
      clientId: `hedge-${Date.now()}`,
    });

    const es = new EventSource(`${getApiBase()}/api/spreads/stream?${params}`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "init" && msg.data.chain) {
        const initial = new Map<string, StrikeQuote>();
        for (const row of msg.data.chain) {
          if (row.put) {
            initial.set(`${row.strike}:P`, {
              strike: row.strike, right: "P", conId: row.put.conId ?? 0,
              bid: row.put.bid, ask: row.put.ask,
              mid: row.put.mid, delta: row.put.delta,
            });
          }
          if (row.call) {
            initial.set(`${row.strike}:C`, {
              strike: row.strike, right: "C", conId: row.call.conId ?? 0,
              bid: row.call.bid, ask: row.call.ask,
              mid: row.call.mid, delta: row.call.delta,
            });
          }
        }
        setQuotes(initial);
        if (msg.data.underlyingPrice) setUnderlyingPrice(msg.data.underlyingPrice);
      }

      if (msg.type === "chain-update") {
        if (msg.data.underlyingPrice) setUnderlyingPrice(msg.data.underlyingPrice);
        for (const u of msg.data.updates ?? []) {
          const key = `${u.strike}:${u.right}`;
          pendingRef.current.set(key, { ...pendingRef.current.get(key), ...u });
        }
      }
    };

    es.onerror = () => setConnected(false);
  }, [symbol, expiration, strikesKey, enabled]);

  // Flush pending updates every 1s
  useEffect(() => {
    const interval = setInterval(() => {
      const pending = pendingRef.current;
      if (pending.size === 0) return;
      setQuotes(prev => {
        const next = new Map(prev);
        for (const [key, update] of pending) {
          const existing = next.get(key);
          if (existing) {
            next.set(key, { ...existing, ...update } as StrikeQuote);
          }
        }
        return next;
      });
      pending.clear();
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [connect]);

  return { quotes, underlyingPrice, connected };
}
