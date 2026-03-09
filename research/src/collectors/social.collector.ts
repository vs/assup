import type { Collector, CollectedData } from "./types.js";

const STALENESS_MINUTES = 360; // 6 hours

const REDDIT_BASE_URL = "https://www.reddit.com";
const STOCKTWITS_BASE_URL = "https://api.stocktwits.com/api/2";
const USER_AGENT = "AssupResearch/1.0";

interface RedditPost {
  data: {
    title: string;
    selftext: string;
    created_utc: number;
    score: number;
    num_comments: number;
    permalink: string;
    subreddit: string;
  };
}

interface RedditSearchResponse {
  data: {
    children: RedditPost[];
  };
}

interface StocktwitsMessage {
  id: number;
  body: string;
  created_at: string;
  user: {
    username: string;
  };
  sentiment?: {
    basic: "Bullish" | "Bearish" | null;
  } | null;
}

interface StocktwitsResponse {
  response: {
    status: number;
  };
  messages: StocktwitsMessage[] | null;
}

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

async function fetchRedditPosts(symbol: string): Promise<SocialPost[]> {
  const params = new URLSearchParams({
    q: symbol,
    subreddit: "wallstreetbets+options+stocks",
    sort: "new",
    limit: "25",
  });

  const url = `${REDDIT_BASE_URL}/search.json?${params.toString()}`;

  const response = await globalThis.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Reddit API returned ${response.status} for ${symbol}: ${response.statusText}`
    );
  }

  const result = (await response.json()) as RedditSearchResponse;
  const children = result.data?.children ?? [];

  return children.map((child) => ({
    source: "reddit" as const,
    title: child.data.title ?? "",
    body: (child.data.selftext ?? "").slice(0, 500),
    timestamp: new Date(child.data.created_utc * 1000).toISOString(),
    score: child.data.score ?? 0,
    comments: child.data.num_comments ?? 0,
    subreddit: child.data.subreddit ?? "",
    sentiment: null,
    url: child.data.permalink
      ? `${REDDIT_BASE_URL}${child.data.permalink}`
      : "",
  }));
}

async function fetchStocktwitsPosts(symbol: string): Promise<SocialPost[]> {
  const url = `${STOCKTWITS_BASE_URL}/streams/symbol/${encodeURIComponent(symbol)}.json`;

  const response = await globalThis.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(
      `StockTwits API returned ${response.status} for ${symbol}: ${response.statusText}`
    );
  }

  const result = (await response.json()) as StocktwitsResponse;
  const messages = result.messages ?? [];

  return messages.map((msg) => ({
    source: "stocktwits" as const,
    title: null,
    body: msg.body.slice(0, 500),
    timestamp: msg.created_at,
    score: null,
    comments: null,
    subreddit: null,
    sentiment: msg.sentiment?.basic ?? null,
    url: null,
  }));
}

export const socialCollector: Collector = {
  source: "social",
  defaultSchedule: "0 */6 * * 1-5", // Every 6 hours on market days
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectedData> {
    const [redditResult, stocktwitsResult] = await Promise.allSettled([
      fetchRedditPosts(symbol),
      fetchStocktwitsPosts(symbol),
    ]);

    const redditPosts =
      redditResult.status === "fulfilled" ? redditResult.value : null;
    const stocktwitsPosts =
      stocktwitsResult.status === "fulfilled" ? stocktwitsResult.value : null;

    if (redditPosts === null && stocktwitsPosts === null) {
      const redditErr =
        redditResult.status === "rejected" ? redditResult.reason : "unknown";
      const stocktwitsErr =
        stocktwitsResult.status === "rejected"
          ? stocktwitsResult.reason
          : "unknown";
      throw new Error(
        `Failed to fetch social data from both sources for ${symbol}. ` +
          `Reddit error: ${redditErr}. StockTwits error: ${stocktwitsErr}.`
      );
    }

    const allPosts: SocialPost[] = [
      ...(redditPosts ?? []),
      ...(stocktwitsPosts ?? []),
    ];

    return {
      source: "social",
      data: {
        symbol,
        redditMentionCount: redditPosts?.length ?? 0,
        stocktwitsMentionCount: stocktwitsPosts?.length ?? 0,
        totalMentionCount: allPosts.length,
        posts: allPosts,
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + STALENESS_MINUTES * 60 * 1000),
    };
  },
};
