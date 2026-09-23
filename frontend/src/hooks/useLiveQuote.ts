/**
 * Live option/stock quotes from the backend QuoteHub.
 *
 * Quotes arrive as "quote" events on the singleton updates SSE connection
 * (Chrome allows only ~6 connections per origin, so we never open a second
 * EventSource). Components declare interest by conId; this module ref-counts
 * them, posts the full set to the backend (debounced), and re-posts after a
 * reconnect, since the backend keys subscriptions by SSE clientId.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { LiveQuote } from "@assup/shared";
import { quotesApi } from "@/api/quotes";
import { sseManager } from "./useSSE";

/** Debounce so opening a dialog with several contracts posts one request */
const SYNC_DEBOUNCE_MS = 100;
const refCounts = new Map<number, number>();
const quotes = new Map<number, LiveQuote>();
const listeners = new Map<number, Set<() => void>>();

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let lastPostedKey = "";
let sseBound = false;

function scheduleSync(force = false): void {
  if (force) lastPostedKey = "";
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, SYNC_DEBOUNCE_MS);
}

function sync(): void {
  syncTimer = null;
  const clientId = sseManager.clientId;
  const conIds = [...refCounts.keys()].sort((a, b) => a - b);
  if (!clientId) {
    // Not connected yet (or reconnecting): retry while anything is wanted
    if (conIds.length > 0) scheduleSync();
    return;
  }
  const key = `${clientId}:${conIds.join(",")}`;
  if (key === lastPostedKey) return;
  lastPostedKey = key;
  quotesApi.setSubscriptions(clientId, conIds).catch(() => {
    // Retry on the next change; a failed post leaves quotes stale, not wrong
    lastPostedKey = "";
  });
}

function bindSse(): void {
  if (sseBound) return;
  sseBound = true;
  sseManager.addListener("quote", (data) => {
    const { conId, quote } = data as { conId: number; quote: LiveQuote };
    quotes.set(conId, quote);
    listeners.get(conId)?.forEach((fn) => fn());
  });
  sseManager.addConnectionListener((connected) => {
    // A new connection means a new clientId, so the backend has no subscriptions for us
    if (connected) scheduleSync(true);
  });
}

function retain(conId: number, onQuote: () => void): () => void {
  bindSse();
  const unsubscribeSse = sseManager.subscribe();
  refCounts.set(conId, (refCounts.get(conId) ?? 0) + 1);
  if (!listeners.has(conId)) listeners.set(conId, new Set());
  listeners.get(conId)!.add(onQuote);
  scheduleSync();

  return () => {
    const next = (refCounts.get(conId) ?? 1) - 1;
    if (next <= 0) {
      refCounts.delete(conId);
      quotes.delete(conId);
      listeners.delete(conId);
    } else {
      refCounts.set(conId, next);
      listeners.get(conId)?.delete(onQuote);
    }
    scheduleSync();
    unsubscribeSse();
  };
}

/**
 * Stream live bid/ask/greeks for a contract. Returns null until the first
 * quote arrives; check `status` for why values may be missing.
 */
export function useLiveQuote(conId: number | undefined | null): LiveQuote | null {
  const subscribe = useCallback(
    (onChange: () => void) => (conId ? retain(conId, onChange) : () => {}),
    [conId],
  );
  // quotes.get returns the same object until a new quote replaces it
  const getSnapshot = useCallback(() => (conId ? quotes.get(conId) ?? null : null), [conId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
