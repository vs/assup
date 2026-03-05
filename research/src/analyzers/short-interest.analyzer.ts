import type { Analyzer, AnalysisOutput } from "./types.js";

interface ShortInterestHistoricalEntry {
  shortInterest: number;
  shortPercentOfFloat: number;
  settlementDate: string;
  avgDailyVolume: number;
}

function classifyShortLevel(shortPercentOfFloat: number): "low" | "moderate" | "high" | "extreme" {
  if (shortPercentOfFloat >= 20) return "extreme";
  if (shortPercentOfFloat >= 10) return "high";
  if (shortPercentOfFloat >= 5) return "moderate";
  return "low";
}

export const shortInterestAnalyzer: Analyzer = {
  source: "short_interest",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const shortPercentOfFloat = (rawData.shortPercentOfFloat as number) ?? 0;
    const daysToCover = (rawData.daysToCover as number) ?? 0;
    const shortInterestTrend =
      (rawData.shortInterestTrend as "increasing" | "decreasing" | "stable" | "unknown") ??
      "unknown";
    const shortInterestChange = (rawData.shortInterestChange as number | null) ?? null;
    const shortInterestShares = (rawData.shortInterestShares as number) ?? 0;
    const historicalEntries =
      (rawData.historicalEntries as ShortInterestHistoricalEntry[]) ?? [];

    const shortLevel = classifyShortLevel(shortPercentOfFloat);

    let score = 0;
    const signals: string[] = [];

    // --- Short % of float analysis ---
    if (shortLevel === "extreme") {
      // Extreme short interest: bearish sentiment from market, but short squeeze potential
      score -= 1;
      signals.push(
        `Extreme short interest: ${shortPercentOfFloat.toFixed(1)}% of float`
      );
    } else if (shortLevel === "high") {
      score -= 1;
      signals.push(
        `High short interest: ${shortPercentOfFloat.toFixed(1)}% of float`
      );
    } else if (shortLevel === "low") {
      score += 1;
      signals.push(
        `Low short interest: ${shortPercentOfFloat.toFixed(1)}% of float`
      );
    } else {
      signals.push(
        `Moderate short interest: ${shortPercentOfFloat.toFixed(1)}% of float`
      );
    }

    // --- Days to cover analysis ---
    if (daysToCover > 10) {
      score -= 1;
      signals.push(
        `High days to cover (${daysToCover.toFixed(1)}) — significant short position relative to volume`
      );
    } else if (daysToCover < 3 && daysToCover > 0) {
      score += 1;
      signals.push(
        `Low days to cover (${daysToCover.toFixed(1)}) — shorts can exit quickly`
      );
    } else if (daysToCover > 0) {
      signals.push(`Days to cover: ${daysToCover.toFixed(1)}`);
    }

    // --- Trend analysis ---
    if (shortInterestTrend === "decreasing") {
      score += 1;
      signals.push("Short interest is decreasing — bears are covering");
    } else if (shortInterestTrend === "increasing") {
      score -= 1;
      signals.push("Short interest is increasing — growing bearish conviction");
    } else if (shortInterestTrend === "stable") {
      signals.push("Short interest is stable");
    }

    // --- Short squeeze potential ---
    // High short % + decreasing trend = potential squeeze (bullish)
    if (
      (shortLevel === "high" || shortLevel === "extreme") &&
      shortInterestTrend === "decreasing"
    ) {
      score += 2; // Strong bullish signal — squeeze potential
      signals.push(
        "Short squeeze potential: high short interest with decreasing trend"
      );
    }

    // --- Rising short % with high days to cover is strongly bearish ---
    if (shortInterestTrend === "increasing" && daysToCover > 10) {
      score -= 1;
      signals.push(
        "Bearish combination: rising short interest with high days to cover"
      );
    }

    // Determine signal
    let signal: "bullish" | "bearish" | "neutral";
    if (score >= 2) signal = "bullish";
    else if (score <= -2) signal = "bearish";
    else signal = "neutral";

    // Confidence based on data quality and signal strength
    let confidence = Math.min(Math.abs(score) / 5, 1);

    // Reduce confidence if we have limited historical data
    if (historicalEntries.length < 2) {
      confidence = Math.max(confidence * 0.5, 0.1);
    }

    // Minimal data: very low confidence
    if (shortPercentOfFloat === 0 && daysToCover === 0) {
      signal = "neutral";
      confidence = 0.1;
      signals.length = 0;
      signals.push("Insufficient short interest data for meaningful analysis");
    }

    const summary =
      signals.length > 0
        ? signals.join(". ") + "."
        : "No short interest data available for analysis.";

    return {
      signal,
      confidence,
      summary,
      details: {
        shortPercentOfFloat,
        daysToCover,
        shortInterestTrend,
        shortInterestChange,
        shortInterestShares,
        shortLevel,
        historicalEntryCount: historicalEntries.length,
      },
    };
  },
};
