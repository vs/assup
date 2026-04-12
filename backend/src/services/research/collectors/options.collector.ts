import type { Collector, CollectionResult } from "./types.js";
import { createIBKRProvider } from "../providers/ibkr.provider.js";
import { ibkrService } from "../../../services/ibkr.js";
import { isMarketOpen } from "../../../utils/market.js";

const STALENESS_MINUTES = 24 * 60; // 1440 minutes (24h)

export const optionsCollector: Collector = {
  source: "options",
  defaultSchedule: "0 18 * * 1-5", // 6 PM ET weekdays
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectionResult> {
    if (!ibkrService.isConnected()) {
      return {
        _tag: "skipped",
        source: "options",
        reason: "TWS not connected — options data requires IBKR",
        expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
      };
    }

    // Switch to Live/Frozen data (same technique as options scanner)
    const marketDataType = isMarketOpen() ? 1 : 2;
    try {
      ibkrService.setMarketDataType(marketDataType as 1 | 2);
    } catch {
      // continue with whatever type is active
    }

    try {
      const provider = createIBKRProvider();
      const chain = await provider.getOptionsChain(symbol, 4);

      if (chain.length === 0) {
        return {
          _tag: "skipped",
          source: "options",
          reason: `No options chain available for ${symbol}`,
          expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
        };
      }

      return {
        source: "options",
        data: {
          symbol,
          chain,
          fetchedAt: new Date().toISOString(),
        },
        expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
      };
    } finally {
      // Always revert to Delayed to avoid subscription costs
      try {
        ibkrService.setMarketDataType(3);
      } catch {
        // ignore
      }
    }
  },
};
