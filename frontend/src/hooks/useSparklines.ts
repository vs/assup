import { useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import { api } from "@/api";
import type { SparklinePoint } from "@assup/shared";

// ---------------------------------------------------------------------------
// Module-level cache shared across all useSparklines instances
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: SparklinePoint[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes – matches backend TTL

const cache = new Map<string, CacheEntry>();
const inflight = new Set<string>(); // symbols currently being fetched
const listeners = new Set<() => void>();
let cacheVersion = 0;

function notifyListeners() {
  cacheVersion++;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot() {
  return cacheVersion;
}

function isCacheValid(key: string): boolean {
  const entry = cache.get(key);
  return !!entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

async function fetchBatch(symbols: string[]) {
  const toFetch = symbols.filter((s) => {
    const key = s.toUpperCase();
    return !isCacheValid(key) && !inflight.has(key);
  });

  if (toFetch.length === 0) return;

  for (const s of toFetch) inflight.add(s.toUpperCase());
  notifyListeners(); // signal loading state

  try {
    const results = await api.historical.getBatchSparklines(toFetch);

    for (const s of toFetch) {
      const key = s.toUpperCase();
      const data = results[key];
      cache.set(key, {
        data: data && data.length > 0 ? data : [],
        fetchedAt: Date.now(),
      });
      inflight.delete(key);
    }
  } catch (error) {
    console.error("Failed to fetch sparklines:", error);
    for (const s of toFetch) {
      const key = s.toUpperCase();
      // Cache empty result so we don't retry immediately
      cache.set(key, { data: [], fetchedAt: Date.now() });
      inflight.delete(key);
    }
  }

  notifyListeners();
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSparklines(symbols: string[]) {
  // Subscribe to cache changes
  useSyncExternalStore(subscribe, getSnapshot);

  const symbolsKey = symbols.join(",");
  const prevKeyRef = useRef("");

  useEffect(() => {
    if (symbolsKey === prevKeyRef.current) return;
    prevKeyRef.current = symbolsKey;

    const current = symbolsKey.split(",").filter(Boolean);
    if (current.length > 0) {
      fetchBatch(current);
    }
  }, [symbolsKey]);

  const getSparklineState = useCallback(
    (symbol: string) => {
      const key = symbol.toUpperCase();
      const entry = cache.get(key);
      return {
        data: entry?.data || [],
        loading: inflight.has(key),
        error: !!entry && entry.data.length === 0 && !inflight.has(key),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheVersion]
  );

  const reset = useCallback(() => {
    cache.clear();
    inflight.clear();
    prevKeyRef.current = "";
    notifyListeners();
  }, []);

  return {
    getSparklineState,
    reset,
    isLoading: inflight.size > 0,
  };
}
