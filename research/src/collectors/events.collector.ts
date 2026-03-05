import type { Collector, CollectedData } from "./types.js";
import { getMarketDataProvider } from "../providers/index.js";

const STALENESS_MINUTES = 720; // 12 hours

export const eventsCollector: Collector = {
  source: "events",
  defaultSchedule: "0 18 * * 1-5", // 6 PM ET weekdays
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectedData> {
    const provider = getMarketDataProvider();

    const [earningsResult, dividendsResult] = await Promise.allSettled([
      provider.getEarningsCalendar(symbol),
      provider.getDividendCalendar(symbol),
    ]);

    const earnings =
      earningsResult.status === "fulfilled" ? earningsResult.value : null;
    const dividends =
      dividendsResult.status === "fulfilled" ? dividendsResult.value : null;

    if (earnings === null && dividends === null) {
      const earningsErr =
        earningsResult.status === "rejected" ? earningsResult.reason : "unknown";
      const dividendsErr =
        dividendsResult.status === "rejected"
          ? dividendsResult.reason
          : "unknown";
      throw new Error(
        `Failed to fetch both earnings and dividend calendar for ${symbol}. ` +
          `Earnings error: ${earningsErr}. Dividends error: ${dividendsErr}.`
      );
    }

    return {
      source: "events",
      data: {
        symbol,
        earnings,
        dividends,
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
    };
  },
};
