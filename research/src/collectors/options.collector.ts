import type { Collector, CollectedData } from "./types.js";
import { getMarketDataProvider } from "../providers/index.js";

const STALENESS_MINUTES = 24 * 60; // 1440 minutes (24h)

export const optionsCollector: Collector = {
  source: "options",
  defaultSchedule: "0 18 * * 1-5", // 6 PM ET weekdays
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectedData> {
    const provider = getMarketDataProvider();

    const chain = await provider.getOptionsChain(symbol, 4);

    if (chain.length === 0) {
      throw new Error(`No options chain data returned for ${symbol}`);
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
  },
};
