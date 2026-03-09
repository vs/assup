import type { Collector, CollectedData } from "./types.js";

const POLYGON_BASE_URL = "https://api.polygon.io";
const STALENESS_MINUTES = 7 * 24 * 60; // 10080 minutes (7 days)

interface ShortInterestEntry {
  shortInterest: number;
  shortPercentOfFloat: number;
  settlementDate: string;
  avgDailyVolume: number;
}

interface PolygonShortInterestResponse {
  results: Array<{
    short_volume?: number;
    short_exempt_volume?: number;
    short_interest?: number;
    short_percent_of_float?: number;
    settlement_date?: string;
    date?: string;
    avg_daily_volume?: number;
    shares_short?: number;
    float_shares?: number;
    days_to_cover?: number;
  }>;
  status: string;
}

function computeDaysToCover(shortInterest: number, avgDailyVolume: number): number {
  if (avgDailyVolume <= 0) return 0;
  return shortInterest / avgDailyVolume;
}

function computeShortInterestTrend(
  entries: ShortInterestEntry[]
): "increasing" | "decreasing" | "stable" | "unknown" {
  if (entries.length < 2) return "unknown";

  const latest = entries[0];
  const previous = entries[1];

  const changePercent =
    previous.shortPercentOfFloat > 0
      ? ((latest.shortPercentOfFloat - previous.shortPercentOfFloat) /
          previous.shortPercentOfFloat) *
        100
      : 0;

  if (changePercent > 5) return "increasing";
  if (changePercent < -5) return "decreasing";
  return "stable";
}

export const shortInterestCollector: Collector = {
  source: "short_interest",
  defaultSchedule: "0 18 1,15 * *", // Bi-weekly: 1st and 15th of each month at 6 PM
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectedData> {
    const apiKey = process.env.MARKET_DATA_API_KEY;
    if (!apiKey) {
      throw new Error(
        "MARKET_DATA_API_KEY not configured — required for Polygon short interest data"
      );
    }

    // Polygon's short interest endpoint — may not be available on all tiers
    const url = new URL(
      `/v3/reference/tickers/${symbol}/short-interest`,
      POLYGON_BASE_URL
    );
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("limit", "10");
    url.searchParams.set("order", "desc");
    url.searchParams.set("sort", "settlement_date");

    const response = await globalThis.fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Polygon short interest API returned ${response.status} for ${symbol}: ${body}`
      );
    }

    const result = (await response.json()) as PolygonShortInterestResponse;

    if (!result.results || result.results.length === 0) {
      throw new Error(
        `No short interest data returned by Polygon for ${symbol}. ` +
          `This endpoint may not be available on your Polygon plan or for this ticker.`
      );
    }

    const entries: ShortInterestEntry[] = result.results.map((r) => {
      const settlementDate = r.settlement_date ?? r.date;
      if (!settlementDate) {
        throw new Error(
          `Short interest entry missing settlement_date for ${symbol}. ` +
            `Check Polygon API response format.`
        );
      }
      return {
        shortInterest: r.short_interest ?? r.shares_short ?? 0,
        shortPercentOfFloat: r.short_percent_of_float ?? 0,
        settlementDate,
        avgDailyVolume: r.avg_daily_volume ?? 0,
      };
    });

    const latest = entries[0];
    const daysToCover = computeDaysToCover(latest.shortInterest, latest.avgDailyVolume);
    const shortInterestTrend = computeShortInterestTrend(entries);

    const shortInterestChange =
      entries.length >= 2
        ? latest.shortPercentOfFloat - entries[1].shortPercentOfFloat
        : null;

    return {
      source: "short_interest",
      data: {
        symbol,
        shortInterestShares: latest.shortInterest,
        shortPercentOfFloat: latest.shortPercentOfFloat,
        daysToCover,
        shortInterestTrend,
        shortInterestChange,
        settlementDate: latest.settlementDate,
        avgDailyVolume: latest.avgDailyVolume,
        historicalEntries: entries,
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
    };
  },
};
