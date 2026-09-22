/**
 * Shared options utilities used by both scanner and research pipeline.
 * Single source of truth for market data type switching, strike filtering,
 * contract key construction, and option metric calculations.
 */

import { SecType } from "@stoqey/ib";
import { ibkrService, type OptionChainEntry } from "../services/ibkr.js";
import { parseExpirationDate } from "./market.js";

// --- Symbol Configuration ---

/**
 * Index-specific option configuration: trading class, multiplier,
 * and optional price-source mapping for mini indices (e.g. XSP → SPX/10).
 */
export const SYMBOL_CONFIG: Record<
  string,
  {
    tradingClass: string;
    multiplier: number;
    /** Substitute symbol used only for the underlying price snapshot/stream.
     *  E.g. XSP redirects to SPX since the SPX index quote is more reliable.
     *  Option chain definitions and option contracts still use the original symbol. */
    priceSymbol?: string;
    /** Divisor to derive this symbol's price from the priceSymbol's price (e.g. XSP = SPX / 10) */
    priceDivisor?: number;
    /** Minimum price increment for combo/spread orders (default 0.01) */
    comboTickSize?: number;
    /** Exchange for BAG combo order legs. Index options trade exclusively on CBOE,
     *  so direct CBOE routing avoids the SMART NonGuaranteed requirement (error 10043). */
    comboExchange?: string;
  }
> = {
  SPX: { tradingClass: "SPXW", multiplier: 100, comboTickSize: 0.05, comboExchange: "CBOE" },
  XSP: {
    tradingClass: "XSPW",
    multiplier: 100,
    priceSymbol: "SPX",
    priceDivisor: 10,
    comboTickSize: 0.05,
    comboExchange: "CBOE",
  },
  RUT: { tradingClass: "RUTW", multiplier: 100, comboTickSize: 0.05, comboExchange: "CBOE" },
};

/** Well-known index symbols that use SecType.IND and CBOE exchange */
const INDEX_SYMBOLS = new Set(["SPX", "XSP", "RUT", "VIX", "DJX", "NDX"]);

/** Check if a symbol is an index (uses IND secType and CBOE exchange) */
export function isIndexSymbol(symbol: string): boolean {
  return INDEX_SYMBOLS.has(symbol);
}

/** Get the appropriate IBKR contract type and exchange for a symbol's underlying */
export function getSymbolContractType(symbol: string): { secType: SecType; exchange: string } {
  if (isIndexSymbol(symbol)) {
    return { secType: SecType.IND, exchange: "CBOE" };
  }
  return { secType: SecType.STK, exchange: "SMART" };
}

/** Round a price to the nearest tick size increment. */
export function roundToTickSize(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

// --- Market Data Type Switching ---

/**
 * Run an async function with Live (market hours) or Frozen (after hours) market data,
 * reverting to Delayed when done. Used by scanner routes, scan jobs, and research collector.
 */
export async function withLiveMarketData<T>(fn: () => Promise<T>): Promise<T> {
  await ibkrService.acquireLiveMarketData();
  try {
    return await fn();
  } finally {
    ibkrService.releaseLiveMarketData();
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
 * Build the lookup key used by getMarketDataBatch and getOptionQuotes results.
 * Must stay in sync with ibkr.ts getMarketDataBatch() and getOptionQuotes().
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

// --- Days To Expiry ---

/**
 * Calculate calendar days from today to an option expiration date string.
 */
export function getDaysToExpiry(expiration: string, today: Date = new Date()): number {
  const expirationDate = parseExpirationDate(expiration);
  return Math.floor((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// --- Contract Helpers ---

/**
 * Build a standard SMART-routed stock contract for IBKR API calls.
 */
export function stockContract(symbol: string) {
  return { symbol, secType: SecType.STK, exchange: "SMART", currency: "USD" };
}
