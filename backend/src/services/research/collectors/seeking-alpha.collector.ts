import type { Collector, CollectionResult } from "./types.js";
import { fetchSAJson } from "./sa-browser.js";
import { flattenSAMetrics } from "./sa-utils.js";

const SA_API_BASE = "https://seekingalpha.com/api/v3";

const METRIC_FIELDS = [
  "pe_nongaap_fy1",
  "dividend_yield",
  "div_yield_fwd",
  "revenue_growth",
  "marketcap",
].join(",");

export const seekingAlphaCollector: Collector = {
  source: "seeking_alpha",
  defaultSchedule: "0 18 * * 1-5",
  stalenessMinutes: 24 * 60,

  async collect(symbol: string): Promise<CollectionResult> {
    const slug = symbol.toLowerCase();

    const metricsRaw = await fetchSAJson(
      `${SA_API_BASE}/metrics?filter[fields]=${METRIC_FIELDS}&filter[slugs]=${encodeURIComponent(slug)}&minified=false`,
    );

    // Flatten metrics into a simple { field: value } map
    const metrics = flattenSAMetrics(metricsRaw);

    return {
      source: "seeking_alpha",
      data: {
        symbol,
        metrics: metrics ?? null,
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + this.stalenessMinutes * 60 * 1000),
    };
  },
};
