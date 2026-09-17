import type { Collector, CollectionResult } from "./types.js";
import { createIBKRProvider } from "../providers/ibkr.provider.js";
import { ibkrService } from "../../../services/ibkr.js";
import { withLiveMarketData } from "../../../utils/options.js";
import { ivRankService } from "../../ivRank.service.js";

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

    return withLiveMarketData(async () => {
      const provider = createIBKRProvider();
      const chain = await provider.getOptionsChain(symbol, 4);

      if (chain.length === 0) {
        return {
          _tag: "skipped" as const,
          source: "options",
          reason: `No options chain available for ${symbol}`,
          expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
        };
      }

      const ivResult = await ivRankService.getIvRank(symbol);

      return {
        source: "options",
        data: {
          symbol,
          chain,
          ivRank: ivResult.info,
          ivRankUnavailableReason: ivResult.reason,
          fetchedAt: new Date().toISOString(),
        },
        expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
      };
    });
  },
};
