import type { Collector, CollectedData } from "./types.js";
import { fetchMacroQuotes } from "../providers/tradingview.js";

const STALENESS_MINUTES = 24 * 60; // 24 hours

export const macroCollector: Collector = {
  source: "macro",
  defaultSchedule: "0 18 * * 1-5", // 6 PM ET weekdays, daily after close
  stalenessMinutes: STALENESS_MINUTES,

  async collect(_symbol: string): Promise<CollectedData> {
    // This collector runs ONCE GLOBALLY - the symbol parameter is ignored.
    // All data comes from TradingView scanner API (SPX, VIX, HYG, TLT).

    const tvQuotes = await fetchMacroQuotes();

    // Extract TradingView data per symbol
    const tvSpx = tvQuotes["SP:SPX"] ?? null;
    const tvVix = tvQuotes["CBOE:VIX"] ?? null;
    const tvHyg = tvQuotes["AMEX:HYG"] ?? null;
    const tvTlt = tvQuotes["NASDAQ:TLT"] ?? null;

    const vixLevel = tvVix?.close ?? null;
    const sp500Index = tvSpx?.close ?? null;

    if (vixLevel === null && sp500Index === null) {
      throw new Error(
        "Failed to fetch both VIX and S&P 500 macro data from TradingView"
      );
    }

    return {
      source: "macro",
      data: {
        vix: vixLevel,
        vixChange: tvVix?.change ?? null,
        vixSma20: tvVix?.sma20 ?? null,
        sp500Index,
        sp500Sma200: tvSpx?.sma200 ?? null,
        sp500Rsi: tvSpx?.rsi ?? null,
        sp500Change: tvSpx?.change ?? null,
        hygChange: tvHyg?.change ?? null,
        tltChange: tvTlt?.change ?? null,
        putCallRatio: null,
        putCallRatioNote:
          "Put/call ratio is not currently available from the market data provider",
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
    };
  },
};
