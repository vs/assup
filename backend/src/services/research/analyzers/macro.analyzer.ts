import type { Analyzer, AnalysisOutput } from "./types.js";

type VixTrend = "rising" | "falling" | "stable";
type Sp500Trend = "above_sma200" | "below_sma200" | "unknown";
type Regime = "risk_on" | "risk_off" | "neutral";

interface MacroDetails {
  vix: number | null;
  vixTrend: VixTrend;
  vixSma20: number | null;
  sp500Price: number | null;
  sp500Index: number | null;
  sp500Sma200: number | null;
  sp500Trend: Sp500Trend;
  putCallRatio: number | null;
  regime: Regime;
}

function determineVixTrend(
  vix: number | null,
  vixSma20: number | null
): VixTrend {
  if (vix === null || vixSma20 === null || vixSma20 === 0) return "stable";
  const pctDiff = (vix - vixSma20) / vixSma20;
  if (pctDiff > 0.05) return "rising";
  if (pctDiff < -0.05) return "falling";
  return "stable";
}

function determineSp500Trend(
  price: number | null,
  sma200: number | null
): Sp500Trend {
  if (price === null || sma200 === null) return "unknown";
  return price >= sma200 ? "above_sma200" : "below_sma200";
}

export const macroAnalyzer: Analyzer = {
  source: "macro",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const vix = (rawData.vix as number) ?? null;
    const vixSma20 = (rawData.vixSma20 as number) ?? null;
    const sp500Price = (rawData.sp500Price as number) ?? null;
    const sp500Index = (rawData.sp500Index as number) ?? null;
    const sp500Sma200 = (rawData.sp500Sma200 as number) ?? null;
    const putCallRatio = (rawData.putCallRatio as number) ?? null;

    const vixTrend = determineVixTrend(vix, vixSma20);
    const sp500Trend = determineSp500Trend(sp500Price, sp500Sma200);

    // Score individual signals for regime determination
    // Positive scores = risk-on (bullish), negative = risk-off (bearish)
    let score = 0;
    let signalCount = 0;
    const signals: string[] = [];

    // VIX signal
    if (vix !== null) {
      signalCount++;
      if (vix < 18) {
        score += 1;
        signals.push(`VIX low at ${vix.toFixed(1)} (risk-on)`);
      } else if (vix > 25) {
        score -= 1;
        signals.push(`VIX elevated at ${vix.toFixed(1)} (risk-off)`);
      } else {
        signals.push(`VIX at ${vix.toFixed(1)} (neutral range)`);
      }
    }

    // VIX trend as supplemental signal
    if (vixTrend === "rising") {
      signals.push("VIX trending higher (rising fear)");
    } else if (vixTrend === "falling") {
      signals.push("VIX trending lower (declining fear)");
    }

    // SPY relative to 200-day SMA
    if (sp500Price !== null && sp500Sma200 !== null) {
      signalCount++;
      if (sp500Trend === "above_sma200") {
        score += 1;
        const pctAbove = (
          ((sp500Price - sp500Sma200) / sp500Sma200) *
          100
        ).toFixed(1);
        signals.push(
          `SPY at ${sp500Price.toFixed(2)}, ${pctAbove}% above 200-SMA (${sp500Sma200.toFixed(2)})`
        );
      } else {
        score -= 1;
        const pctBelow = (
          ((sp500Sma200 - sp500Price) / sp500Sma200) *
          100
        ).toFixed(1);
        signals.push(
          `SPY at ${sp500Price.toFixed(2)}, ${pctBelow}% below 200-SMA (${sp500Sma200.toFixed(2)})`
        );
      }
    }

    // Put/call ratio
    if (putCallRatio !== null) {
      signalCount++;
      if (putCallRatio < 0.7) {
        score += 1;
        signals.push(
          `P/C ratio ${putCallRatio.toFixed(2)} (bullish, call-heavy)`
        );
      } else if (putCallRatio > 1.2) {
        score -= 1;
        signals.push(
          `P/C ratio ${putCallRatio.toFixed(2)} (bearish, put-heavy)`
        );
      } else {
        signals.push(`P/C ratio ${putCallRatio.toFixed(2)} (neutral)`);
      }
    }

    // Determine regime and signal
    let regime: Regime;
    let signal: "bullish" | "bearish" | "neutral";

    if (signalCount === 0) {
      // No data available at all
      regime = "neutral";
      signal = "neutral";
      signals.push("Insufficient data for regime determination");
    } else if (score > 0 && score >= signalCount * 0.5) {
      // Majority of signals are risk-on
      regime = "risk_on";
      signal = "bullish";
    } else if (score < 0 && Math.abs(score) >= signalCount * 0.5) {
      // Majority of signals are risk-off
      regime = "risk_off";
      signal = "bearish";
    } else {
      // Mixed signals
      regime = "neutral";
      signal = "neutral";
    }

    // Confidence: higher when signals agree, lower when mixed
    const confidence =
      signalCount > 0
        ? Math.min(Math.abs(score) / signalCount, 1)
        : 0;

    const summary =
      signals.length > 0
        ? signals.slice(0, 3).join(". ") + "."
        : "Insufficient data for macro signals.";

    const details: MacroDetails = {
      vix,
      vixTrend,
      vixSma20,
      sp500Price,
      sp500Index,
      sp500Sma200,
      sp500Trend,
      putCallRatio,
      regime,
    };

    return {
      signal,
      confidence,
      summary,
      details: details as unknown as Record<string, unknown>,
    };
  },
};
