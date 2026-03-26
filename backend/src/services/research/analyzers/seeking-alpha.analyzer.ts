import type { Analyzer, AnalysisOutput } from "./types.js";

/**
 * Convert SA sell-side rating (1-5 numeric) to a label.
 * 1 = Strong Sell, 2 = Sell, 3 = Hold, 4 = Buy, 5 = Strong Buy
 */
function sellSideLabel(rating: number): string {
  if (rating >= 4.5) return "Strong Buy";
  if (rating >= 3.5) return "Buy";
  if (rating >= 2.5) return "Hold";
  if (rating >= 1.5) return "Sell";
  return "Strong Sell";
}

function sellSideScore(rating: number): number {
  if (rating >= 4.5) return 2;
  if (rating >= 3.5) return 1;
  if (rating >= 2.5) return 0;
  if (rating >= 1.5) return -1;
  return -2;
}

export const seekingAlphaAnalyzer: Analyzer = {
  source: "seeking_alpha",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const ratings = rawData.ratings as { data?: Array<{ attributes: { ratings: Record<string, number> }; meta: { is_locked: boolean } }> } | null;
    const metrics = rawData.metrics as Record<string, number> | null;

    let score = 0;
    const signals: string[] = [];

    // Extract sell-side (Wall Street) rating from the ratings response
    const ratingData = ratings?.data?.[0];
    const sellSideRating = ratingData?.attributes?.ratings?.sellSideRating;

    if (sellSideRating != null) {
      const label = sellSideLabel(sellSideRating);
      const s = sellSideScore(sellSideRating);
      score += s * 2; // Weight Wall Street consensus heavily
      signals.push(`Wall Street: ${label} (${sellSideRating.toFixed(2)})`);
    }

    // Extract quant/authors ratings if not locked (may be available for older periods)
    const quantRating = ratingData?.attributes?.ratings?.quantRating;
    const authorsRating = ratingData?.attributes?.ratings?.authorsRating;

    if (quantRating != null) {
      const label = sellSideLabel(quantRating);
      const s = sellSideScore(quantRating);
      score += s;
      signals.push(`Quant: ${label} (${quantRating.toFixed(2)})`);
    }

    if (authorsRating != null) {
      const label = sellSideLabel(authorsRating);
      const s = sellSideScore(authorsRating);
      score += s;
      signals.push(`SA Authors: ${label} (${authorsRating.toFixed(2)})`);
    }

    // Add metrics context
    if (metrics) {
      if (metrics.pe_nongaap_fy1 != null) {
        signals.push(`Fwd P/E: ${metrics.pe_nongaap_fy1.toFixed(1)}`);
      }
      if (metrics.revenue_growth != null) {
        const pct = (metrics.revenue_growth * 100).toFixed(1);
        signals.push(`Revenue Growth: ${pct}%`);
        if (metrics.revenue_growth > 0.2) score += 1;
        else if (metrics.revenue_growth < -0.1) score -= 1;
      }
      if (metrics.short_interest_shares_outstanding != null) {
        const pct = (metrics.short_interest_shares_outstanding * 100).toFixed(1);
        signals.push(`Short Interest: ${pct}%`);
      }
    }

    let signal: "bullish" | "bearish" | "neutral";
    if (score >= 2) signal = "bullish";
    else if (score <= -2) signal = "bearish";
    else signal = "neutral";

    const confidence = Math.min(Math.abs(score) / 6, 1);
    const summary = signals.length > 0
      ? signals.join(". ") + "."
      : "No Seeking Alpha data available.";

    return {
      signal,
      confidence,
      summary,
      details: {
        sellSideRating: sellSideRating ?? null,
        quantRating: quantRating ?? null,
        authorsRating: authorsRating ?? null,
        metrics: metrics ?? null,
        rawScore: score,
      },
    };
  },
};
