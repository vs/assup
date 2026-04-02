// backend/src/services/research/collectors/short-interest.collector.ts
import type { Collector, CollectionResult } from "./types.js";
import { fetchSAMetrics } from "./sa-rapidapi.js";

const STALENESS_MINUTES = 24 * 60;

export const shortInterestCollector: Collector = {
  source: "short_interest",
  defaultSchedule: "0 18 * * 1-5",
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectionResult> {
    const metrics = await fetchSAMetrics(symbol, ["short_interest_shares_outstanding"]);

    if (!metrics || metrics.short_interest_shares_outstanding == null) {
      return {
        _tag: "skipped",
        source: "short_interest",
        reason: `No short interest data available from Seeking Alpha for ${symbol}`,
        expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
      };
    }

    return {
      source: "short_interest",
      data: {
        symbol,
        shortPercentOfSO: metrics.short_interest_shares_outstanding,
        daysToCover: 0,
        shortInterestTrend: "unknown" as const,
        shortInterestChange: null,
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
    };
  },
};
