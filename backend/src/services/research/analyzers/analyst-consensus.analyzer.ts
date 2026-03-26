import type { Analyzer, AnalysisOutput } from "./types.js";
import type { AnalystRating } from "../providers/index.js";

const BUY_KEYWORDS = [
  "buy",
  "outperform",
  "overweight",
  "strong buy",
  "positive",
];
const SELL_KEYWORDS = [
  "sell",
  "underperform",
  "underweight",
  "strong sell",
  "negative",
  "reduce",
];
// Hold keywords (for reference): "hold", "neutral", "equal-weight",
// "market perform", "sector perform", "peer perform"
// Any rating not matching buy or sell is classified as hold.

type RatingCategory = "buy" | "hold" | "sell";

function normalizeRating(rating: string): RatingCategory {
  const normalized = rating.toLowerCase().trim();
  if (BUY_KEYWORDS.includes(normalized)) return "buy";
  if (SELL_KEYWORDS.includes(normalized)) return "sell";
  // Default to hold for unknown ratings (including HOLD_KEYWORDS)
  return "hold";
}

interface RecentChange {
  firm: string;
  action: string;
  rating: string;
  date: string;
}

interface ConsensusDetails {
  buyCount: number;
  holdCount: number;
  sellCount: number;
  avgPriceTarget: number | null;
  recentChanges: RecentChange[];
}

function getRecentChanges(
  ratings: AnalystRating[],
  count: number
): RecentChange[] {
  const sorted = [...ratings].sort((a, b) => b.date.localeCompare(a.date));
  return sorted.slice(0, count).map((r) => ({
    firm: r.firm,
    action: r.action,
    rating: r.rating,
    date: r.date,
  }));
}

export const analystConsensusAnalyzer: Analyzer = {
  source: "analyst_consensus",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const ratings = (rawData.ratings as AnalystRating[] | undefined) ?? [];

    // No ratings data: return neutral with zero confidence
    if (ratings.length === 0) {
      return {
        signal: "neutral",
        confidence: 0,
        summary: "No analyst ratings data available.",
        details: {
          buyCount: 0,
          holdCount: 0,
          sellCount: 0,
          avgPriceTarget: null,
          recentChanges: [],
        },
      };
    }

    // Categorize ratings
    let buyCount = 0;
    let holdCount = 0;
    let sellCount = 0;

    for (const r of ratings) {
      const category = normalizeRating(r.rating);
      if (category === "buy") buyCount++;
      else if (category === "sell") sellCount++;
      else holdCount++;
    }

    const total = ratings.length;
    const buyPct = buyCount / total;
    const sellPct = sellCount / total;

    // Average price target
    const priceTargets = ratings
      .map((r) => r.priceTarget)
      .filter((pt): pt is number => pt !== null && pt > 0);
    const avgPriceTarget =
      priceTargets.length > 0
        ? priceTargets.reduce((sum, pt) => sum + pt, 0) / priceTargets.length
        : null;

    // Recent changes (last 5 actions)
    const recentChanges = getRecentChanges(ratings, 5);

    // Count recent upgrades and downgrades
    const recentUpgrades = recentChanges.filter(
      (c) => c.action.toLowerCase() === "upgrade"
    ).length;
    const recentDowngrades = recentChanges.filter(
      (c) => c.action.toLowerCase() === "downgrade"
    ).length;

    // Score signals
    let score = 0;
    const signals: string[] = [];

    // Rating distribution signals
    if (buyPct > 0.5) {
      score += 2;
      signals.push(
        `Majority buy ratings (${buyCount}/${total}, ${(buyPct * 100).toFixed(0)}%)`
      );
    } else if (sellPct > 0.3) {
      score -= 2;
      signals.push(
        `High sell ratings (${sellCount}/${total}, ${(sellPct * 100).toFixed(0)}%)`
      );
    } else {
      signals.push(
        `Mixed ratings: ${buyCount} buy, ${holdCount} hold, ${sellCount} sell`
      );
    }

    // Recent action signals
    if (recentUpgrades > recentDowngrades) {
      score += 1;
      signals.push(`Recent upgrade momentum (${recentUpgrades} upgrade(s))`);
    } else if (recentDowngrades > recentUpgrades) {
      score -= 1;
      signals.push(
        `Recent downgrade momentum (${recentDowngrades} downgrade(s))`
      );
    }

    // Price target signal (only if we have a current price from the data)
    if (avgPriceTarget !== null) {
      signals.push(`Average price target: $${avgPriceTarget.toFixed(2)}`);
    }

    // Determine signal
    let signal: "bullish" | "bearish" | "neutral";
    if (score >= 2) signal = "bullish";
    else if (score <= -2) signal = "bearish";
    else signal = "neutral";

    const confidence = Math.min(Math.abs(score) / 4, 1);

    const details: ConsensusDetails = {
      buyCount,
      holdCount,
      sellCount,
      avgPriceTarget,
      recentChanges,
    };

    const summary =
      signals.length > 0
        ? signals.slice(0, 3).join(". ") + "."
        : "No significant analyst consensus signals.";

    return {
      signal,
      confidence,
      summary,
      details: details as unknown as Record<string, unknown>,
    };
  },
};
