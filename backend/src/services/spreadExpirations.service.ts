/**
 * Fetches and caches available option expirations for spread symbols.
 * Expirations don't change frequently, so a 1-hour cache avoids
 * repeated IBKR API calls when the page loads.
 */

import { ibkrService } from "./ibkr.js";
import { SYMBOL_CONFIG, getSymbolContractType } from "../utils/options.js";
import { resolveUnderlyingConId } from "./underlyingConId.service.js";
import { withTimeout } from "../utils/withTimeout.js";

interface CacheEntry {
  expirations: string[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const SECDEF_TIMEOUT_MS = 15_000;
const cache = new Map<string, CacheEntry>();

export async function getExpirations(symbol: string): Promise<string[]> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.expirations;
  }

  const config = SYMBOL_CONFIG[symbol] ?? {
    tradingClass: symbol,
    multiplier: 100,
  };

  const api = ibkrService.getApi();
  if (!api || !api.isConnected) {
    throw new Error("Not connected to TWS");
  }

  // Always use the actual symbol for chain queries — XSPW is a child of XSP
  // in IBKR's taxonomy, not SPX, so a priceSymbol redirect must not apply here.
  const { secType } = getSymbolContractType(symbol);

  const conId = await resolveUnderlyingConId(api, symbol);

  const secDefs = await withTimeout(
    api.getSecDefOptParams(symbol, "", secType, conId),
    `getSecDefOptParams(${symbol})`,
    SECDEF_TIMEOUT_MS,
  );

  const preferredDefs = secDefs.filter(
    (d: any) => d.tradingClass === config.tradingClass,
  );
  const activeDefs = preferredDefs.length > 0 ? preferredDefs : secDefs;
  if (activeDefs.length === 0) {
    throw new Error(`No security definitions for ${symbol}`);
  }

  const allExpirations = new Set<string>();
  for (const def of activeDefs) {
    if (def.expirations) {
      for (const exp of def.expirations) allExpirations.add(exp);
    }
  }

  const expirations = [...allExpirations].sort();
  cache.set(symbol, { expirations, fetchedAt: Date.now() });
  return expirations;
}
