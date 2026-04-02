// backend/src/services/research/collectors/seeking-alpha.collector.ts
import type { Collector, CollectionResult } from "./types.js";
import { fetchSAMetrics } from "./sa-rapidapi.js";

const METRIC_FIELDS = [
  "pe_nongaap_fy1",
  "dividend_yield",
  "div_yield_fwd",
  "revenue_growth",
  "marketcap",
];

export const seekingAlphaCollector: Collector = {
  source: "seeking_alpha",
  defaultSchedule: "0 18 * * 1-5",
  stalenessMinutes: 24 * 60,

  async collect(symbol: string): Promise<CollectionResult> {
    const metrics = await fetchSAMetrics(symbol, METRIC_FIELDS);

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
