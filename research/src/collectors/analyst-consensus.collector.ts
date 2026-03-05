import type { Collector, CollectedData } from "./types.js";
import type { AnalystRating } from "../providers/types.js";
import { getMarketDataProvider } from "../providers/index.js";

const STALENESS_MINUTES = 24 * 60; // 1440 minutes (24h)

function computeCounts(ratings: AnalystRating[]): {
  buyCount: number;
  holdCount: number;
  sellCount: number;
} {
  const buyKeywords = [
    "buy",
    "outperform",
    "overweight",
    "strong buy",
    "positive",
  ];
  const sellKeywords = [
    "sell",
    "underperform",
    "underweight",
    "strong sell",
    "negative",
    "reduce",
  ];

  let buyCount = 0;
  let holdCount = 0;
  let sellCount = 0;

  for (const r of ratings) {
    const normalized = r.rating.toLowerCase().trim();
    if (buyKeywords.includes(normalized)) {
      buyCount++;
    } else if (sellKeywords.includes(normalized)) {
      sellCount++;
    } else {
      holdCount++;
    }
  }

  return { buyCount, holdCount, sellCount };
}

function computeAvgPriceTarget(ratings: AnalystRating[]): number | null {
  const targets = ratings
    .map((r) => r.priceTarget)
    .filter((pt): pt is number => pt !== null && pt > 0);
  if (targets.length === 0) return null;
  return targets.reduce((sum, pt) => sum + pt, 0) / targets.length;
}

export const analystConsensusCollector: Collector = {
  source: "analyst_consensus",
  defaultSchedule: "0 18 * * 1-5", // 6 PM ET weekdays, daily after close
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectedData> {
    const provider = getMarketDataProvider();
    const ratings = await provider.getAnalystRatings(symbol);

    const { buyCount, holdCount, sellCount } = computeCounts(ratings);
    const avgPriceTarget = computeAvgPriceTarget(ratings);

    return {
      source: "analyst_consensus",
      data: {
        symbol,
        ratings,
        buyCount,
        holdCount,
        sellCount,
        avgPriceTarget,
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
    };
  },
};
