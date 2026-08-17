/**
 * Fetches and caches available option expirations for spread symbols.
 * Expirations don't change frequently, so a 1-hour cache avoids
 * repeated IBKR API calls when the page loads.
 */

import { Contract } from "@stoqey/ib";
import { ibkrService } from "./ibkr.js";
import { SYMBOL_CONFIG, getSymbolContractType } from "../utils/options.js";

interface CacheEntry {
  expirations: string[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
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
  const optionSymbol = config.optionSymbol ?? symbol;

  const api = ibkrService.getApi();
  if (!api || !api.isConnected) {
    throw new Error("Not connected to TWS");
  }

  const { secType, exchange } = getSymbolContractType(optionSymbol);

  const underlyingContract: Contract = {
    symbol: optionSymbol,
    secType,
    exchange,
    currency: "USD",
  };

  const contractDetails = await api.getContractDetails(underlyingContract);
  if (!contractDetails.length) {
    throw new Error(`No contract details for ${optionSymbol}`);
  }
  const conId = contractDetails[0].contract.conId!;

  const secDefs = await api.getSecDefOptParams(
    optionSymbol,
    "",
    secType,
    conId,
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
