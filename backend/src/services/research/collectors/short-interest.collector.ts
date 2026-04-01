import type { Collector, CollectionResult } from "./types.js";
import { fetchSAJson } from "./sa-browser.js";

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

    const metrics = flattenMetrics(raw);

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

/** Flatten the SA v3 metrics response into { field: value } */
function flattenMetrics(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const json = raw as {
    data?: Array<{ attributes: { value: number }; relationships: { metric_type: { data: { id: string } } } }>;
    included?: Array<{ id: string; type: string; attributes: { field: string } }>;
  };
  if (!json.data || !json.included) return null;

  const typeMap = new Map<string, string>();
  for (const inc of json.included) {
    if (inc.type === "metric_type") {
      typeMap.set(inc.id, inc.attributes.field);
    }
  }

  const result: Record<string, number> = {};
  for (const item of json.data) {
    const field = typeMap.get(item.relationships.metric_type.data.id);
    if (field) {
      result[field] = item.attributes.value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}
