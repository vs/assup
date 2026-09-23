/**
 * Live quotes streamed from the backend QuoteHub over SSE.
 * Mirrors the backend Quote shape (backend/src/services/quotes/quoteTypes.ts).
 */

export type LiveQuoteStatus =
  | "ok"
  | "pending"
  | "no-market"
  | "timeout"
  | "no-contract"
  | "not-subscribed"
  | "no-lines"
  | "error";

export interface LiveQuote {
  key: string;
  status: LiveQuoteStatus;
  bid?: number;
  ask?: number;
  last?: number;
  close?: number;
  open?: number;
  volume?: number;
  delta?: number;
  theta?: number;
  iv?: number;
  undPrice?: number;
  noMarket?: Array<"bid" | "ask">;
  updatedAt: number | null;
  error?: string;
}

/** Mid price, or null when either side is missing */
export function quoteMid(q: LiveQuote | null | undefined): number | null {
  if (!q || q.bid == null || q.ask == null) return null;
  return (q.bid + q.ask) / 2;
}
