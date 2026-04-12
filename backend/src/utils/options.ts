/**
 * Shared options utilities used by both scanner and research pipeline.
 * Single source of truth for market data type switching, strike filtering,
 * contract key construction, and option metric calculations.
 */

import { SecType } from "@stoqey/ib";
import { ibkrService, type OptionChainEntry } from "../services/ibkr.js";
import { isMarketOpen } from "./market.js";

// --- Market Data Type Switching ---

/**
 * Run an async function with Live (market hours) or Frozen (after hours) market data,
 * reverting to Delayed when done. Used by scanner routes, scan jobs, and research collector.
 */
export async function withLiveMarketData<T>(fn: () => Promise<T>): Promise<T> {
  const type = isMarketOpen() ? 1 : 2;
  try {
    ibkrService.setMarketDataType(type as 1 | 2);
  } catch {
    // continue with whatever type is active
  }

  try {
    return await fn();
  } finally {
    try {
      ibkrService.setMarketDataType(3); // Delayed
    } catch {
      // ignore
    }
  }
}

// --- Underlying Price ---

/**
 * Fetch the current price for a stock symbol via IBKR.
 * Returns last price, falling back to close, or null if unavailable.
 */
export async function getUnderlyingPrice(symbol: string): Promise<number | null> {
  try {
    const data = await ibkrService.getMarketData({
      symbol,
      secType: SecType.STK,
      exchange: "SMART",
      currency: "USD",
    });
    return data?.last ?? data?.close ?? null;
  } catch {
    return null;
  }
}

/**
 * Determine a reference price for strike filtering.
 * Uses the underlying price if available, otherwise falls back to the median strike.
 */
export function getReferencePrice(
  underlyingPrice: number | null,
  strikes: number[],
): number {
  if (underlyingPrice && underlyingPrice > 0) return underlyingPrice;
  const sorted = [...strikes].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

// --- Chain Filtering ---

/**
 * Filter option chain entries to strikes within a percentage range of a reference price.
 * Default range 50%-150% matches the scanner's typical near-money filtering.
 */
export function filterChainByStrike(
  chain: OptionChainEntry[],
  refPrice: number,
  minPct = 50,
  maxPct = 150,
): OptionChainEntry[] {
  const minStrike = refPrice * (minPct / 100);
  const maxStrike = refPrice * (maxPct / 100);
  return chain.filter((e) => e.strike >= minStrike && e.strike <= maxStrike);
}

// --- Contract Key ---

/**
 * Build the lookup key used by getMarketDataBatch results.
 * Must stay in sync with ibkr.ts getMarketDataBatch().
 */
export function marketDataKey(contract: {
  symbol?: string;
  lastTradeDateOrContractMonth?: string;
  strike?: number;
  right?: string;
}): string {
  return `${contract.symbol}_${contract.lastTradeDateOrContractMonth}_${contract.strike}_${contract.right}`;
}

// --- Option Metrics ---

export interface OptionMetrics {
  midPrice: number;
  premiumPercent: number;
  annualizedReturn: number;
}

/**
 * Calculate standard option metrics from bid/ask, strike, and days to expiry.
 */
export function calcOptionMetrics(
  bid: number,
  ask: number,
  strike: number,
  daysToExpiry: number,
): OptionMetrics {
  const midPrice = (bid + ask) / 2;
  const premiumPercent = strike > 0 ? (midPrice / strike) * 100 : 0;
  const annualizedReturn = daysToExpiry > 0 ? (premiumPercent * 365) / daysToExpiry : 0;
  return { midPrice, premiumPercent, annualizedReturn };
}

// --- Delta Estimation ---

/**
 * Estimate absolute delta from moneyness when TWS doesn't provide it.
 * Simple linear approximation: ATM ≈ 0.5, scales toward 0 (OTM) or 1 (ITM).
 */
export function estimateDelta(
  strike: number,
  underlyingPrice: number,
  right: "PUT" | "CALL" | "C" | "P",
): number {
  const moneyness = strike / underlyingPrice;
  const isPut = right === "PUT" || right === "P";
  if (isPut) {
    return Math.abs(Math.max(-0.95, Math.min(-0.05, -0.5 - (moneyness - 1) * 2)));
  }
  return Math.max(0.05, Math.min(0.95, 0.5 - (moneyness - 1) * 2));
}
