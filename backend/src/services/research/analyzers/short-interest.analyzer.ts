import type { Analyzer, AnalysisOutput } from "./types.js";

function classifyShortLevel(shortPercentOfSO: number): "low" | "moderate" | "high" | "extreme" {
  if (shortPercentOfSO >= 15) return "extreme";
  if (shortPercentOfSO >= 8) return "high";
  if (shortPercentOfSO >= 4) return "moderate";
  return "low";
}

export const shortInterestAnalyzer: Analyzer = {
  source: "short_interest",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const shortPercentOfSORaw = (rawData.shortPercentOfSO as number) ?? 0;
    const daysToCover = (rawData.daysToCover as number) ?? 0;
    const shortInterestTrend =
      (rawData.shortInterestTrend as "increasing" | "decreasing" | "stable" | "unknown") ??
      "unknown";
    const shortInterestChange = (rawData.shortInterestChange as number | null) ?? null;

    // SA metric is already a percentage (e.g. 18.07 = 18.07%)
    const shortPercentOfSO = shortPercentOfSORaw;

    // Early return when data is missing
    if (shortPercentOfSO === 0) {
      return {
        signal: "neutral",
        confidence: 0.1,
        summary: "Insufficient short interest data for meaningful analysis.",
        details: {
          shortPercentOfSO,
          daysToCover,
          shortInterestTrend,
          shortInterestChange,
          shortLevel: "low",
        },
      };
    }

    const shortLevel = classifyShortLevel(shortPercentOfSO);

    let score = 0;
    const signals: string[] = [];

    // --- Short % of S/O analysis ---
    if (shortLevel === "extreme") {
      score -= 1;
      signals.push(
        `Extreme short interest: ${shortPercentOfSO.toFixed(1)}% of S/O`
      );
    } else if (shortLevel === "high") {
      score -= 1;
      signals.push(
        `High short interest: ${shortPercentOfSO.toFixed(1)}% of S/O`
      );
    } else if (shortLevel === "low") {
      score += 1;
      signals.push(
        `Low short interest: ${shortPercentOfSO.toFixed(1)}% of S/O`
      );
    } else {
      signals.push(
        `Moderate short interest: ${shortPercentOfSO.toFixed(1)}% of S/O`
      );
    }

    // --- Days to cover analysis (only if available) ---
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
    if (
      (shortLevel === "high" || shortLevel === "extreme") &&
      shortInterestTrend === "decreasing"
    ) {
      score += 2;
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

    let signal: "bullish" | "bearish" | "neutral";
    if (score >= 2) signal = "bullish";
    else if (score <= -2) signal = "bearish";
    else signal = "neutral";

    // Confidence: with real SA data we can be more confident
    const confidence = Math.min(Math.abs(score) / 4 + 0.3, 1);

    const summary = signals.join(". ") + ".";

    return {
      signal,
      confidence,
      summary,
      details: {
        shortPercentOfSO,
        daysToCover,
        shortInterestTrend,
        shortInterestChange,
        shortLevel,
      },
    };
  },
};
