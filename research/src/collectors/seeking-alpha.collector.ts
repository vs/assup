import type { Collector, CollectedData } from "./types.js";

const SA_BASE_URL = "https://seeking-alpha.p.rapidapi.com";

export const seekingAlphaCollector: Collector = {
  source: "seeking_alpha",
  defaultSchedule: "0 18 * * 1-5",
  stalenessMinutes: 24 * 60,

  async collect(symbol: string): Promise<CollectedData> {
    const apiKey = process.env.SEEKING_ALPHA_API_KEY;
    if (!apiKey) {
      throw new Error("SEEKING_ALPHA_API_KEY not configured");
    }

    const headers = {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": "seeking-alpha.p.rapidapi.com",
    };

    const [ratingsRes, metricsRes] = await Promise.allSettled([
      globalThis.fetch(`${SA_BASE_URL}/symbols/${symbol}/ratings`, { headers }),
      globalThis.fetch(`${SA_BASE_URL}/symbols/${symbol}/metrics`, { headers }),
    ]);

    const ratings =
      ratingsRes.status === "fulfilled" && ratingsRes.value.ok
        ? await ratingsRes.value.json()
        : null;

    const metrics =
      metricsRes.status === "fulfilled" && metricsRes.value.ok
        ? await metricsRes.value.json()
        : null;

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
