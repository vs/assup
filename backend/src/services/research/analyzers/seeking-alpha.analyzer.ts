import type { Analyzer, AnalysisOutput } from "./types.js";

export const seekingAlphaAnalyzer: Analyzer = {
  source: "seeking_alpha",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const metrics = rawData.metrics as Record<string, number> | null;

    let score = 0;
    const signals: string[] = [];

    if (metrics) {
      if (metrics.pe_nongaap_fy1 != null) {
        signals.push(`Fwd P/E: ${metrics.pe_nongaap_fy1.toFixed(1)}`);
      }
      if (metrics.revenue_growth != null) {
        signals.push(`Revenue Growth: ${metrics.revenue_growth.toFixed(1)}%`);
        if (metrics.revenue_growth > 20) score += 1;
        else if (metrics.revenue_growth < -10) score -= 1;
      }
      if (metrics.dividend_yield != null) {
        signals.push(`Dividend Yield: ${metrics.dividend_yield.toFixed(2)}%`);
      }
      if (metrics.div_yield_fwd != null && metrics.dividend_yield == null) {
        signals.push(`Fwd Dividend Yield: ${metrics.div_yield_fwd.toFixed(2)}%`);
      }
      if (metrics.marketcap != null) {
        const b = metrics.marketcap / 1e9;
        signals.push(`Market Cap: $${b.toFixed(1)}B`);
      }
    }

    let signal: "bullish" | "bearish" | "neutral";
    if (score >= 1) signal = "bullish";
    else if (score <= -1) signal = "bearish";
    else signal = "neutral";

    const confidence = Math.min(Math.abs(score) / 3, 1);
    const summary = signals.length > 0
      ? signals.join(". ") + "."
      : "No Seeking Alpha metrics available.";

    return {
      signal,
      confidence,
      summary,
      details: {
        metrics: metrics ?? null,
        rawScore: score,
      },
    };
  },
};
