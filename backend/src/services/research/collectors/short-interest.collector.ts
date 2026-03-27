import { SecType } from "@stoqey/ib";
import { ibkrService } from "../../ibkr.js";
import type { Collector, CollectionResult } from "./types.js";

const STALENESS_MINUTES = 7 * 24 * 60; // 7 days

export const shortInterestCollector: Collector = {
  source: "short_interest",
  defaultSchedule: "0 18 1,15 * *", // Bi-weekly: 1st and 15th of each month at 6 PM
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectionResult> {
    if (!ibkrService.isConnected()) {
      return {
        _tag: "skipped",
        source: "short_interest",
        reason: "IBKR not connected — short interest collector requires TWS",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // retry in 1h
      };
    }

    const contract = {
      symbol,
      secType: SecType.STK,
      exchange: "SMART",
      currency: "USD",
    };

    // Fetch shortable data (tick 236) and basic market data for avg volume
    const enhanced = await ibkrService.getEnhancedMarketData(contract, "236");
    const marketData = await ibkrService.getMarketData(contract);

    const shortableShares = enhanced?.shortableShares ?? 0;
    const shortableIndicator = enhanced?.shortableIndicator ?? 0;

    // AVG_VOLUME tick (type 21) from regular market data snapshot
    // getMarketData doesn't request generic ticks, so avg volume may not be available.
    // Use last price as a proxy indicator that data is flowing.
    const lastPrice = marketData?.last ?? marketData?.close ?? 0;

    if (shortableShares === 0 && shortableIndicator === 0 && lastPrice === 0) {
      return {
        _tag: "skipped",
        source: "short_interest",
        reason: `No shortable/market data available from IBKR for ${symbol}`,
        expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
      };
    }

    // IBKR shortable indicator: >2.5 = easy to borrow, 1.5-2.5 = limited, <1.5 = not shortable
    const isShortable = shortableIndicator > 2.5;
    const isLimited = shortableIndicator >= 1.5 && shortableIndicator <= 2.5;

    // We don't have short % of float or historical trend from IBKR,
    // so we provide what's available and set unknowns to reflect that.
    // The analyzer handles missing data gracefully.
    return {
      source: "short_interest",
      data: {
        symbol,
        shortInterestShares: shortableShares, // shares available to short (proxy)
        shortPercentOfFloat: 0, // Not available from IBKR
        daysToCover: 0, // Cannot calculate without short interest volume
        shortInterestTrend: "unknown" as const,
        shortInterestChange: null,
        settlementDate: new Date().toISOString().split("T")[0],
        avgDailyVolume: 0,
        shortableIndicator,
        shortableStatus: isShortable ? "available" : isLimited ? "limited" : "not_shortable",
        sharesAvailable: shortableShares,
        historicalEntries: [],
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
    };
  },
};
