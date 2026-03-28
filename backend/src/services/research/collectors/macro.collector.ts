import type { Collector, CollectedData } from "./types.js";
import { getMarketDataProvider } from "../providers/index.js";
import { fetchTvQuotes } from "../providers/tradingview.js";

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

    // Fetch real index values (SPX, VIX) from TradingView
    // and historical data from IBKR (SPY for SMA200, VIX for SMA20)
    const [tvResult, vixHistResult, spyHistResult] =
      await Promise.allSettled([
        fetchTvQuotes(["SP:SPX", "CBOE:VIX"]),
        provider.getHistoricalOHLCV("VIX", vixFrom, today, "day"),
        provider.getHistoricalOHLCV("SPY", spyFrom, today, "day"),
      ]);

    const tvQuotes =
      tvResult.status === "fulfilled" ? tvResult.value : null;
    const vixHist =
      vixHistResult.status === "fulfilled" ? vixHistResult.value : null;
    const spyHist =
      spyHistResult.status === "fulfilled" ? spyHistResult.value : null;

    // Extract TradingView index values
    const tvSpx = tvQuotes?.["SP:SPX"] ?? null;
    const tvVix = tvQuotes?.["CBOE:VIX"] ?? null;

    const vixLevel = tvVix?.close ?? (vixHist && vixHist.length > 0
      ? vixHist[vixHist.length - 1].close
      : null);

    const sp500Index = tvSpx?.close ?? null;

    // SPY price from historical for SMA calculation (sp500Price stays SPY-based)
    const sp500Price = spyHist && spyHist.length > 0
      ? spyHist[spyHist.length - 1].close
      : null;

    // If we have no data from any source, throw
    const vixFailed = vixLevel === null && (!vixHist || vixHist.length === 0);
    const spyFailed = sp500Index === null && sp500Price === null;

    if (vixFailed && spyFailed) {
      const errors: string[] = [];
      if (tvResult.status === "rejected")
        errors.push(`TradingView: ${tvResult.reason}`);
      if (vixHistResult.status === "rejected")
        errors.push(`VIX hist: ${vixHistResult.reason}`);
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

    // Compute SPY 200-day SMA (used for trend analysis)
    let sp500Sma200: number | null = null;
    if (spyHist && spyHist.length >= 200) {
      const last200 = spyHist.slice(-200);
      sp500Sma200 = last200.reduce((sum, d) => sum + d.close, 0) / 200;
    }

    return {
      source: "macro",
      data: {
        vix: vixLevel,
        vixSma20,
        vixHistory: vixHist,
        sp500Index,
        sp500Price,
        sp500Sma200,
        spyHistory: spyHist,
        putCallRatio: null,
        putCallRatioNote:
          "Put/call ratio is not currently available from the market data provider",
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
    };
  },
};
