import type { Collector, CollectedData } from "./types.js";
import { getMarketDataProvider } from "../providers/index.js";
import { fetchMacroQuotes } from "../providers/tradingview.js";

const STALENESS_MINUTES = 24 * 60; // 24 hours

export const macroCollector: Collector = {
  source: "macro",
  defaultSchedule: "0 18 * * 1-5", // 6 PM ET weekdays, daily after close
  stalenessMinutes: STALENESS_MINUTES,

  async collect(_symbol: string): Promise<CollectedData> {
    // This collector runs ONCE GLOBALLY - the symbol parameter is ignored.
    const provider = getMarketDataProvider();

    const today = new Date().toISOString().split("T")[0];

    // SPY: need ~250 trading days of historical data for 200-day SMA (fallback)
    const spyFrom = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    // Fetch enriched macro data from TradingView (SPX, VIX, HYG, TLT)
    // and SPY historical from IBKR as fallback for SMA200
    const [tvResult, spyHistResult] = await Promise.allSettled([
      fetchMacroQuotes(),
      provider.getHistoricalOHLCV("SPY", spyFrom, today, "day"),
    ]);

    const tvQuotes =
      tvResult.status === "fulfilled" ? tvResult.value : null;
    const spyHist =
      spyHistResult.status === "fulfilled" ? spyHistResult.value : null;

    // Extract TradingView data per symbol
    const tvSpx = tvQuotes?.["SP:SPX"] ?? null;
    const tvVix = tvQuotes?.["CBOE:VIX"] ?? null;
    const tvHyg = tvQuotes?.["AMEX:HYG"] ?? null;
    const tvTlt = tvQuotes?.["NASDAQ:TLT"] ?? null;

    const vixLevel = tvVix?.close ?? null;
    const sp500Index = tvSpx?.close ?? null;

    // SPY price from historical for SMA calculation (sp500Price stays SPY-based)
    const sp500Price = spyHist && spyHist.length > 0
      ? spyHist[spyHist.length - 1].close
      : null;

    // If we have no data from any source, throw
    const vixFailed = vixLevel === null;
    const spyFailed = sp500Index === null && sp500Price === null;

    if (vixFailed && spyFailed) {
      const errors: string[] = [];
      if (tvResult.status === "rejected")
        errors.push(`TradingView: ${tvResult.reason}`);
      if (spyHistResult.status === "rejected")
        errors.push(`SPY hist: ${spyHistResult.reason}`);
      throw new Error(
        `Failed to fetch both VIX and SPY macro data: ${errors.join("; ")}`
      );
    }

    // VIX SMA20 from TradingView directly
    const vixSma20 = tvVix?.sma20 ?? null;

    // SPX SMA200 from TradingView, fall back to computed from SPY historical
    let sp500Sma200 = tvSpx?.sma200 ?? null;
    if (sp500Sma200 === null && spyHist && spyHist.length >= 200) {
      const last200 = spyHist.slice(-200);
      sp500Sma200 = last200.reduce((sum, d) => sum + d.close, 0) / 200;
    }

    // New enriched fields from TradingView
    const sp500Rsi = tvSpx?.rsi ?? null;
    const sp500Change = tvSpx?.change ?? null;
    const hygChange = tvHyg?.change ?? null;
    const tltChange = tvTlt?.change ?? null;

    return {
      source: "macro",
      data: {
        vix: vixLevel,
        vixSma20,
        sp500Index,
        sp500Price,
        sp500Sma200,
        sp500Rsi,
        sp500Change,
        hygChange,
        tltChange,
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
