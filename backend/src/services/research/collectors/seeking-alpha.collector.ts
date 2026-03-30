import type { Collector, CollectionResult } from "./types.js";
import { fetchSAJson } from "./sa-browser.js";

const SA_API_BASE = "https://seekingalpha.com/api/v3";

const METRIC_FIELDS = [
  "pe_nongaap_fy1",
  "dividend_yield",
  "div_yield_fwd",
  "revenue_growth",
  "marketcap",
  "short_interest_shares_outstanding",
].join(",");

export const seekingAlphaCollector: Collector = {
  source: "seeking_alpha",
  defaultSchedule: "0 18 * * 1-5",
  stalenessMinutes: 24 * 60,

  async collect(symbol: string): Promise<CollectionResult> {
    const slug = symbol.toLowerCase();

    const [ratings, metricsRaw] = await Promise.all([
      fetchSAJson(
        `${SA_API_BASE}/symbols/${encodeURIComponent(slug)}/rating/periods?filter[periods][]=0`,
      ),
      fetchSAJson(
        `${SA_API_BASE}/metrics?filter[fields]=${METRIC_FIELDS}&filter[slugs]=${encodeURIComponent(slug)}&minified=false`,
      ),
    ]);

    // Flatten metrics into a simple { field: value } map
    const metrics = flattenMetrics(metricsRaw);

    if (!ratings && !metrics) {
      throw new Error(`No Seeking Alpha data returned for ${symbol}`);
    }

    return {
      source: "seeking_alpha",
      data: {
        symbol,
        ratings,
        metrics,
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + this.stalenessMinutes * 60 * 1000),
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
