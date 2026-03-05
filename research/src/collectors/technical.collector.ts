import type { Collector, CollectedData } from "./types.js";
import { getMarketDataProvider } from "../providers/index.js";

const STALENESS_MINUTES = 24 * 60;

export const technicalCollector: Collector = {
  source: "technical",
  defaultSchedule: "0 18 * * 1-5", // 6 PM ET weekdays
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectedData> {
    const provider = getMarketDataProvider();

    const to = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const ohlcv = await provider.getHistoricalOHLCV(symbol, from, to, "day");

    if (ohlcv.length === 0) {
      throw new Error(`No OHLCV data returned for ${symbol}`);
    }

    const quote = await provider.getQuote(symbol).catch(() => null);

    return {
      source: "technical",
      data: {
        symbol,
        ohlcv,
        currentPrice: quote?.last ?? ohlcv[ohlcv.length - 1].close,
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
    };
  },
};
