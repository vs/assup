import type { Collector, CollectionResult } from "./types.js";
import { fetchSAJson } from "./sa-browser.js";
import { flattenSAMetrics } from "./sa-utils.js";

const SA_API_BASE = "https://seekingalpha.com/api/v3";
const STALENESS_MINUTES = 24 * 60; // 24 hours

const METRIC_FIELDS = [
  "short_interest_shares_outstanding",
].join(",");

export const shortInterestCollector: Collector = {
  source: "short_interest",
  defaultSchedule: "0 18 * * 1-5", // Daily weekdays at 6 PM
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectionResult> {
    const slug = symbol.toLowerCase();

    const raw = await fetchSAJson(
      `${SA_API_BASE}/metrics?filter[fields]=${METRIC_FIELDS}&filter[slugs]=${encodeURIComponent(slug)}&minified=false`,
    );

    const metrics = flattenSAMetrics(raw);

    if (!metrics || metrics.short_interest_shares_outstanding == null) {
      return {
        _tag: "skipped",
        source: "short_interest",
        reason: `No short interest data available from Seeking Alpha for ${symbol}`,
        expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
      };
    }

    const shortPercentOfSO = metrics.short_interest_shares_outstanding; // decimal, e.g. 0.05 = 5%

    return {
      source: "short_interest",
      data: {
        symbol,
        shortPercentOfSO,
        daysToCover: 0, // Not available from SA
        shortInterestTrend: "unknown" as const,
        shortInterestChange: null,
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
    };
  },
};
