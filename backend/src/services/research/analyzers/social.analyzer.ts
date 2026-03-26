import type { Analyzer, AnalysisOutput } from "./types.js";

interface SocialPost {
  source: "reddit" | "stocktwits";
  title: string | null;
  body: string;
  timestamp: string;
  score: number | null;
  comments: number | null;
  subreddit: string | null;
  sentiment: string | null;
  url: string | null;
}

interface TopPost {
  source: string;
  title: string | null;
  body: string;
  timestamp: string;
  sentimentScore: number;
}

const POSITIVE_WORDS = [
  "bullish",
  "buy",
  "moon",
  "calls",
  "breakout",
  "undervalued",
  "dip",
  "long",
  "upside",
  "growth",
  "strong",
  "beat",
  "squeeze",
  "rocket",
  "rally",
];

const NEGATIVE_WORDS = [
  "bearish",
  "sell",
  "puts",
  "crash",
  "overvalued",
  "dump",
  "short",
  "downside",
  "weak",
  "miss",
  "bubble",
  "tank",
  "drill",
  "baghold",
  "loss",
];

function computePostSentiment(text: string): number {
  const lower = text.toLowerCase();
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of POSITIVE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = lower.match(regex);
    if (matches) {
      positiveCount += matches.length;
    }
  }

  for (const word of NEGATIVE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = lower.match(regex);
    if (matches) {
      negativeCount += matches.length;
    }
  }

  const total = positiveCount + negativeCount;
  if (total === 0) return 0;

  // Score between -1 and 1
  return (positiveCount - negativeCount) / total;
}

function getPostText(post: SocialPost): string {
  const parts: string[] = [];
  if (post.title) parts.push(post.title);
  if (post.body) parts.push(post.body);
  return parts.join(" ");
}

export const socialAnalyzer: Analyzer = {
  source: "social",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const posts = (rawData.posts as SocialPost[]) ?? [];
    const totalMentionCount = (rawData.totalMentionCount as number) ?? 0;
    const redditMentionCount = (rawData.redditMentionCount as number) ?? 0;
    const stocktwitsMentionCount =
      (rawData.stocktwitsMentionCount as number) ?? 0;

    if (posts.length === 0) {
      return {
        signal: "neutral",
        confidence: 0.1,
        summary: "No social media mentions found.",
        details: {
          mentionCount: 0,
          sentimentScore: 0,
          mentionTrend: "unknown",
          topPosts: [],
        },
      };
    }

    // Compute per-post sentiment scores
    const postSentiments = posts.map((post) => {
      const text = getPostText(post);
      const sentimentScore = computePostSentiment(text);
      return { post, sentimentScore };
    });

    // Aggregate sentiment: weighted average of all post scores
    const totalSentiment = postSentiments.reduce(
      (sum, ps) => sum + ps.sentimentScore,
      0
    );
    const sentimentScore = totalSentiment / postSentiments.length;

    // Select top 5 posts by absolute sentiment score (most opinionated)
    const topPosts: TopPost[] = [...postSentiments]
      .sort((a, b) => Math.abs(b.sentimentScore) - Math.abs(a.sentimentScore))
      .slice(0, 5)
      .map((ps) => ({
        source: ps.post.source,
        title: ps.post.title,
        body: ps.post.body.slice(0, 200),
        timestamp: ps.post.timestamp,
        sentimentScore: ps.sentimentScore,
      }));

    // Determine signal based on sentiment score
    let signal: "bullish" | "bearish" | "neutral";
    if (sentimentScore > 0.2) {
      signal = "bullish";
    } else if (sentimentScore < -0.2) {
      signal = "bearish";
    } else {
      signal = "neutral";
    }

    // Confidence based on mention count and sentiment strength
    const sentimentStrength = Math.abs(sentimentScore);
    const mentionFactor = Math.min(totalMentionCount / 25, 1); // More mentions = more confidence
    const confidence = Math.min(sentimentStrength * 0.6 + mentionFactor * 0.4, 1);

    // Build summary
    const signals: string[] = [];

    if (signal === "bullish") {
      signals.push(
        `Positive social sentiment (score: ${sentimentScore.toFixed(2)}) across ${totalMentionCount} mentions`
      );
    } else if (signal === "bearish") {
      signals.push(
        `Negative social sentiment (score: ${sentimentScore.toFixed(2)}) across ${totalMentionCount} mentions`
      );
    } else {
      signals.push(
        `Mixed social sentiment (score: ${sentimentScore.toFixed(2)}) across ${totalMentionCount} mentions`
      );
    }

    if (redditMentionCount > 0) {
      signals.push(`${redditMentionCount} Reddit mentions`);
    }
    if (stocktwitsMentionCount > 0) {
      signals.push(`${stocktwitsMentionCount} StockTwits mentions`);
    }

    const summary =
      signals.length > 0
        ? signals.join(". ") + "."
        : "No significant social sentiment signals.";

    return {
      signal,
      confidence,
      summary,
      details: {
        mentionCount: totalMentionCount,
        sentimentScore,
        mentionTrend: "unknown",
        topPosts,
      },
    };
  },
};
