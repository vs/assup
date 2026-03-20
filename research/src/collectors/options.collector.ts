import type { Collector, CollectionResult } from "./types.js";
import { getMarketDataProvider } from "../providers/index.js";

const STALENESS_MINUTES = 24 * 60; // 1440 minutes (24h)

export const optionsCollector: Collector = {
  source: "options",
  defaultSchedule: "0 18 * * 1-5", // 6 PM ET weekdays
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectionResult> {
    const provider = getMarketDataProvider();

    let chain;
    try {
      chain = await provider.getOptionsChain(symbol, 4);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("error 403") || msg.includes("error 404")) {
        return {
          _tag: "skipped",
          source: "options",
          reason: `Polygon options API not authorized (${msg.includes("403") ? "403" : "404"})`,
          expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
        };
      }
      throw err;
    }

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
