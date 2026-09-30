/**
 * App-wide cached position + wheel lookup.
 * Fetches once on first call, re-fetches every 60s.
 * Designed for lightweight lookups in hover cards, etc.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";
import type { Position, WheelTickerSummary } from "@assup/shared";

interface PositionLookup {
  position: Position | null;
  wheel: WheelTickerSummary | null;
}

// Module-level cache so all hook instances share the same data
let cachedPositions: Position[] | null = null;
let cachedWheel: WheelTickerSummary[] | null = null;
let fetchPromise: Promise<void> | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 60_000;
let listeners: Array<() => void> = [];

function notifyListeners() {
  for (const fn of listeners) fn();
}

async function fetchAll() {
  const [posResult, wheelResult] = await Promise.allSettled([
    api.positions.list(),
    api.wheel.list().then((r) => r.tickers),
  ]);
  if (posResult.status === "fulfilled") cachedPositions = posResult.value;
  if (wheelResult.status === "fulfilled") cachedWheel = wheelResult.value;
  lastFetchTime = Date.now();
  fetchPromise = null;
  notifyListeners();
}

function ensureFresh() {
  if (fetchPromise) return fetchPromise;
  if (cachedPositions && Date.now() - lastFetchTime < CACHE_TTL) return;
  fetchPromise = fetchAll();
  return fetchPromise;
}

export function usePositionLookup(symbol: string | null): PositionLookup {
  const [, setTick] = useState(0);

  const rerender = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    listeners.push(rerender);
    ensureFresh();
    return () => {
      listeners = listeners.filter((fn) => fn !== rerender);
    };
  }, [rerender]);

  // Trigger refresh when symbol changes (in case cache is stale)
  useEffect(() => {
    ensureFresh();
  }, [symbol]);

  if (!symbol) return { position: null, wheel: null };

  const position = cachedPositions?.find(
    (p) => p.symbol === symbol && p.secType === "STK",
  ) ?? null;

  const wheel = cachedWheel?.find((w) => w.symbol === symbol) ?? null;

  return { position, wheel };
}

/** Force refresh the cache (e.g. after a trade). */
export function invalidatePositionLookup() {
  lastFetchTime = 0;
  ensureFresh();
}
