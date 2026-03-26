import type { Collector, CollectedData } from "./types.js";
import { getMarketDataProvider } from "../providers/index.js";

const STALENESS_MINUTES = 24 * 60; // 24 hours

export const macroCollector: Collector = {
  source: "macro",
  defaultSchedule: "0 18 * * 1-5", // 6 PM ET weekdays, daily after close
  stalenessMinutes: STALENESS_MINUTES,

  async collect(_symbol: string): Promise<CollectedData> {
    // This collector runs ONCE GLOBALLY - the symbol parameter is ignored.
    const provider = getMarketDataProvider();

    const today = new Date().toISOString().split("T")[0];

    // VIX: need 20-day historical for SMA plus current quote
    const vixFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    // SPY: need ~250 trading days of historical data for 200-day SMA
    const spyFrom = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    // Use Promise.allSettled so partial data is still useful
    const [vixQuoteResult, vixHistResult, spyQuoteResult, spyHistResult] =
      await Promise.allSettled([
        provider.getQuote("VIX"),
        provider.getHistoricalOHLCV("VIX", vixFrom, today, "day"),
        provider.getQuote("SPY"),
        provider.getHistoricalOHLCV("SPY", spyFrom, today, "day"),
      ]);

    const vixQuote =
      vixQuoteResult.status === "fulfilled" ? vixQuoteResult.value : null;
    const vixHist =
      vixHistResult.status === "fulfilled" ? vixHistResult.value : null;
    const spyQuote =
      spyQuoteResult.status === "fulfilled" ? spyQuoteResult.value : null;
    const spyHist =
      spyHistResult.status === "fulfilled" ? spyHistResult.value : null;

    // If BOTH VIX and SPY fail entirely, throw an error
    const vixFailed = !vixQuote && (!vixHist || vixHist.length === 0);
    const spyFailed = !spyQuote && (!spyHist || spyHist.length === 0);

    if (vixFailed && spyFailed) {
      const errors: string[] = [];
      if (vixQuoteResult.status === "rejected")
        errors.push(`VIX quote: ${vixQuoteResult.reason}`);
      if (vixHistResult.status === "rejected")
        errors.push(`VIX hist: ${vixHistResult.reason}`);
      if (spyQuoteResult.status === "rejected")
        errors.push(`SPY quote: ${spyQuoteResult.reason}`);
      if (spyHistResult.status === "rejected")
        errors.push(`SPY hist: ${spyHistResult.reason}`);
      throw new Error(
        `Failed to fetch both VIX and SPY macro data: ${errors.join("; ")}`
      );
    }

    // Compute VIX 20-day SMA
    let vixSma20: number | null = null;
    if (vixHist && vixHist.length >= 20) {
      const last20 = vixHist.slice(-20);
      vixSma20 = last20.reduce((sum, d) => sum + d.close, 0) / 20;
    }

    // Compute SPY 200-day SMA
    let sp500Sma200: number | null = null;
    if (spyHist && spyHist.length >= 200) {
      const last200 = spyHist.slice(-200);
      sp500Sma200 = last200.reduce((sum, d) => sum + d.close, 0) / 200;
    }

    // Extract current values
    const vixLevel =
      vixQuote?.last ?? (vixHist && vixHist.length > 0
        ? vixHist[vixHist.length - 1].close
        : null);

    const sp500Price =
      spyQuote?.last ?? (spyHist && spyHist.length > 0
        ? spyHist[spyHist.length - 1].close
        : null);

    return {
      source: "macro",
      data: {
        vix: vixLevel,
        vixSma20,
        vixHistory: vixHist,
        sp500Price,
        sp500Sma200,
        spyHistory: spyHist,
        putCallRatio: null, // Not available from the provider initially
        putCallRatioNote:
          "Put/call ratio is not currently available from the market data provider",
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
    };
  },
};
