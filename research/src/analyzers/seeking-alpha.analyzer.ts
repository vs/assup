import type { Analyzer, AnalysisOutput } from "./types.js";

const RATING_SCORES: Record<string, number> = {
  strong_buy: 2,
  buy: 1,
  hold: 0,
  sell: -1,
  strong_sell: -2,
};

function extractRating(ratings: Record<string, unknown> | null, key: string): string | null {
  if (!ratings) return null;
  const data = ratings as { data?: { attributes?: Record<string, unknown> } };
  const attrs = data?.data?.attributes;
  if (!attrs) return null;
  return (attrs[key] as string) || null;
}

export const seekingAlphaAnalyzer: Analyzer = {
  source: "seeking_alpha",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const ratings = rawData.ratings as Record<string, unknown> | null;

    const quantRating = extractRating(ratings, "quantRating");
    const wallStreetRating = extractRating(ratings, "wallStreetRating");
    const saAuthorsRating = extractRating(ratings, "saAuthorsRating");

    let score = 0;
    const signals: string[] = [];

    if (quantRating && quantRating in RATING_SCORES) {
      const s = RATING_SCORES[quantRating];
      score += s * 2; // Weight quant rating more heavily
      signals.push(`Quant: ${quantRating.replace("_", " ")}`);
    }

    if (wallStreetRating && wallStreetRating in RATING_SCORES) {
      const s = RATING_SCORES[wallStreetRating];
      score += s;
      signals.push(`Wall Street: ${wallStreetRating.replace("_", " ")}`);
    }

    if (saAuthorsRating && saAuthorsRating in RATING_SCORES) {
      const s = RATING_SCORES[saAuthorsRating];
      score += s;
      signals.push(`SA Authors: ${saAuthorsRating.replace("_", " ")}`);
    }

    let signal: "bullish" | "bearish" | "neutral";
    if (score >= 2) signal = "bullish";
    else if (score <= -2) signal = "bearish";
    else signal = "neutral";

    const confidence = Math.min(Math.abs(score) / 6, 1);
    const summary = signals.length > 0
      ? signals.join(". ") + "."
      : "No Seeking Alpha ratings available.";

    return {
      signal,
      confidence,
      summary,
      details: {
        quantRating,
        wallStreetRating,
        saAuthorsRating,
        rawScore: score,
      },
    };
  },
};
