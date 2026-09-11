/**
 * Shared option scanning logic used by both the interactive scanner
 * (scanner.ts) and background scan jobs (scannerJobs.ts).
 *
 * Extracts the per-symbol scan loop, option chain filtering, market data
 * fetching, and opportunity evaluation into a single reusable function.
 */

import { ibkrService, type OptionChainEntry } from "./ibkr.js";
import type { OptionOpportunity, ScannerCriteria } from "@assup/shared";
import {
  withLiveMarketData,
  getUnderlyingPrice,
  getReferencePrice,
  filterChainByStrike,
  marketDataKey,
  calcOptionMetrics,
  estimateDelta,
  getDaysToExpiry,
} from "../utils/options.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ScanCallbacks {
  onTotalSymbols?: (count: number) => void | Promise<void>;
  onSymbolComplete: (
    symbol: string,
    assetClass: string,
    opportunities: OptionOpportunity[],
  ) => void | Promise<void>;
  onFetching?: (symbol: string, assetClass: string, contractCount: number) => void;
}

export interface ScanContext {
  symbolAssignments: Map<string, { name: string; color: string }>;
  criteria: ScannerCriteria;
  signal?: AbortSignal;
  callbacks: ScanCallbacks;
}

export interface ScanOutcome {
  opportunities: OptionOpportunity[];
  /**
   * Symbols that could not be scanned (TWS timeout, chain lookup failure, …).
   * These are NOT zero-opportunity results — the symbol was never evaluated.
   */
  failures: SymbolScanFailure[];
}

export interface SymbolScanFailure {
  symbol: string;
  error: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Scan option chains for every symbol in `ctx.symbolAssignments`.
 *
 * For each symbol the function:
 *   1. Fetches the underlying price
 *   2. Retrieves the option chain and deduplicates by expiration/strike
 *   3. Filters by DTE and strike range (separate ranges for PUTs and CALLs)
 *   4. Fetches market data for the matching contracts in batch
 *   5. Evaluates each contract against the criteria (return, premium, delta)
 *   6. Reports per-symbol results via `callbacks.onSymbolComplete`
 *
 * Returns the full (unsorted) array of qualifying opportunities, plus the list
 * of symbols that failed to scan so callers can distinguish "nothing matched"
 * from "we never got an answer from TWS".
 */
export async function scanSymbols(ctx: ScanContext): Promise<ScanOutcome> {
  const { symbolAssignments, criteria, signal, callbacks } = ctx;
  const symbols = Array.from(symbolAssignments.keys());

  if (callbacks.onTotalSymbols) {
    await callbacks.onTotalSymbols(symbols.length);
  }

  const allOpportunities: OptionOpportunity[] = [];
  const failures: SymbolScanFailure[] = [];

  await withLiveMarketData(async () => {
    for (const symbol of symbols) {
      // Check for cancellation
      if (signal?.aborted) {
        break;
      }

      const assetClassInfo = symbolAssignments.get(symbol);
      if (!assetClassInfo) continue;

      const symbolOpportunities: OptionOpportunity[] = [];

      try {
        // Get current price of underlying stock
        const underlyingPrice = (await getUnderlyingPrice(symbol)) ?? undefined;

        // Get options chain
        console.log(`[Scanner] ${symbol}: fetching option chain…`);
        const chain = await ibkrService.getOptionChain(symbol);
        if (chain.length === 0) {
          console.log(`[Scanner] ${symbol}: empty option chain, skipping`);
          await callbacks.onSymbolComplete(symbol, assetClassInfo.name, []);
          continue;
        }

        const today = new Date();
        const uniqueStrikes = [...new Set(chain.map((c) => c.strike))].sort((a, b) => a - b);
        const referencePrice = getReferencePrice(underlyingPrice ?? null, uniqueStrikes);

        // Determine which option types to scan
        const optionTypes = criteria.optionTypes || "PUT";
        const scanPuts = optionTypes === "PUT";
        const scanCalls = optionTypes === "CALL";

        // Filter by expiration
        const expirationFilteredChain = chain.filter((entry) => {
          const dte = getDaysToExpiry(entry.expiration, today);
          return dte >= criteria.minDaysToExpiry && dte <= criteria.maxDaysToExpiry;
        });

        if (expirationFilteredChain.length === 0) {
          console.log(`[Scanner] ${symbol}: ${chain.length} chain entries, 0 after DTE filter (${criteria.minDaysToExpiry}-${criteria.maxDaysToExpiry}d), skipping`);
          await callbacks.onSymbolComplete(symbol, assetClassInfo.name, []);
          continue;
        }

        // Filter by strike ranges (separate for PUTs and CALLs)
        const putFilteredChain = scanPuts
          ? filterChainByStrike(expirationFilteredChain, referencePrice, criteria.putMinStrikePercent, criteria.putMaxStrikePercent)
          : [];
        const callFilteredChain = scanCalls
          ? filterChainByStrike(expirationFilteredChain, referencePrice, criteria.callMinStrikePercent, criteria.callMaxStrikePercent)
          : [];

        if (putFilteredChain.length === 0 && callFilteredChain.length === 0) {
          console.log(`[Scanner] ${symbol}: ${expirationFilteredChain.length} after DTE filter, 0 after strike filter (ref $${referencePrice.toFixed(2)}), skipping`);
          await callbacks.onSymbolComplete(symbol, assetClassInfo.name, []);
          continue;
        }

        // Collect contracts to get market data for
        const contracts: OptionChainEntry["put"][] = [];
        if (scanPuts) contracts.push(...putFilteredChain.map((e) => e.put));
        if (scanCalls) contracts.push(...callFilteredChain.map((e) => e.call));

        console.log(`[Scanner] ${symbol}: chain ${chain.length}, after filters ${contracts.length} contracts, fetching market data…`);

        // Notify caller about fetching phase
        if (callbacks.onFetching) {
          callbacks.onFetching(symbol, assetClassInfo.name, contracts.length);
        }

        // Get market data for options contracts
        const marketDataMap = await ibkrService.getMarketDataBatch(contracts);

        // Process PUT options
        if (scanPuts) {
          for (const entry of putFilteredChain) {
            const opp = processOption(
              entry, "PUT", entry.put,
              getDaysToExpiry(entry.expiration, today),
              marketDataMap, criteria, symbol, assetClassInfo, underlyingPrice,
            );
            if (opp) symbolOpportunities.push(opp);
          }
        }

        // Process CALL options
        if (scanCalls) {
          for (const entry of callFilteredChain) {
            const opp = processOption(
              entry, "CALL", entry.call,
              getDaysToExpiry(entry.expiration, today),
              marketDataMap, criteria, symbol, assetClassInfo, underlyingPrice,
            );
            if (opp) symbolOpportunities.push(opp);
          }
        }

        console.log(`[Scanner] ${symbol}: done, ${symbolOpportunities.length} opportunities found`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Scanner] ${symbol}: error —`, reason);
        failures.push({ symbol, error: reason });
      }

      allOpportunities.push(...symbolOpportunities);
      await callbacks.onSymbolComplete(symbol, assetClassInfo.name, symbolOpportunities);
    }
  });

  return { opportunities: allOpportunities, failures };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Evaluate a single option contract against the scan criteria.
 * Returns an OptionOpportunity if the contract passes all filters, or null.
 */
function processOption(
  entry: OptionChainEntry,
  optionType: "PUT" | "CALL",
  contract: OptionChainEntry["put"],
  daysToExpiry: number,
  marketDataMap: Map<string, { bid?: number; ask?: number; delta?: number }>,
  criteria: ScannerCriteria,
  symbol: string,
  assetClassInfo: { name: string; color: string },
  underlyingPrice: number | undefined,
): OptionOpportunity | null {
  const data = marketDataMap.get(marketDataKey(contract));

  if (!data || data.bid === undefined || data.ask === undefined || data.bid <= 0 || data.ask <= 0) {
    return null;
  }

  const { midPrice, premiumPercent, annualizedReturn } = calcOptionMetrics(
    data.bid, data.ask, entry.strike, daysToExpiry,
  );

  // Filter by criteria
  const passesReturn = annualizedReturn >= criteria.minAnnualizedReturn;
  const passesPremium = premiumPercent >= criteria.minPremiumPercent;

  // Delta filtering - use absolute value since puts have negative delta
  let absDelta: number | null = null;
  if (data.delta !== undefined) {
    absDelta = Math.abs(data.delta);
  } else if (underlyingPrice && underlyingPrice > 0) {
    absDelta = estimateDelta(entry.strike, underlyingPrice, optionType);
  }
  const passesDelta = absDelta === null || (absDelta >= criteria.minDelta && absDelta <= criteria.maxDelta);

  if (passesReturn && passesPremium && passesDelta) {
    return {
      symbol,
      assetClassName: assetClassInfo.name,
      assetClassColor: assetClassInfo.color,
      strike: entry.strike,
      expiration: entry.expiration,
      daysToExpiry,
      optionType,
      bid: data.bid,
      ask: data.ask,
      midPrice,
      delta: data.delta,
      annualizedReturn,
      premiumPercent,
      underlyingPrice,
    };
  }

  return null;
}
