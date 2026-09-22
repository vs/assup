import type { Collector, CollectionResult } from "./types.js";
import { redditFetch, RedditUnavailableError } from "./reddit-auth.js";

const STALENESS_MINUTES = 360; // 6 hours

const REDDIT_BASE_URL = "https://www.reddit.com";
const STOCKTWITS_BASE_URL = "https://api.stocktwits.com/api/2";
const USER_AGENT = "AssupResearch/1.0";
const REQUEST_TIMEOUT_MS = 15_000;

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

/**
 * Per-source outcome.
 *
 * A source that could not be read is never folded into the data as an empty
 * result — "nobody is talking about this ticker" and "we were blocked" are
 * different facts, and only the first one is a signal.
 */
export type SourceOutcome =
  | { status: "ok"; posts: SocialPost[] }
  | { status: "unavailable"; reason: string };

function tickerInTitle(title: string, symbol: string): boolean {
  // Escape regex special chars (e.g., BRK.B → BRK\.B)
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (symbol.length < 3) {
    // Short tickers require $ prefix to avoid matching common words
    return new RegExp(`\\$${escaped}\\b`, "i").test(title);
  }
  // Match word boundary or $ prefix
  return new RegExp(`(?:\\$|\\b)${escaped}\\b`, "i").test(title);
}

async function fetchRedditPosts(symbol: string): Promise<SocialPost[]> {
  const params = new URLSearchParams({
    q: symbol,
    restrict_sr: "true",
    sort: "relevance",
    limit: "25",
  });

  // Reddit closed its unauthenticated *.json endpoints; all reads go through
  // the OAuth host with client-credentials auth.
  const result = (await redditFetch(
    `/r/wallstreetbets+options+stocks+investing/search?${params.toString()}`
  )) as RedditSearchResponse;

  const children = result.data?.children ?? [];

  return children
    .map((child) => ({
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
    }))
    .filter((post) => (post.score ?? 0) >= 1);
}

async function fetchStocktwitsPosts(symbol: string): Promise<SocialPost[]> {
  const url = `${STOCKTWITS_BASE_URL}/streams/symbol/${encodeURIComponent(symbol)}.json`;

  const response = await globalThis.fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    // StockTwits fronts its public API with a Cloudflare bot challenge, which
    // answers a plain server-side request with 403 and an HTML page.
    const hint =
      response.status === 403
        ? " — StockTwits is serving a Cloudflare bot challenge, which a server-side request cannot answer"
        : "";
    throw new Error(
      `StockTwits API returned ${response.status} for ${symbol}: ${response.statusText}${hint}`
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

async function collectSource(
  label: string,
  fetcher: () => Promise<SocialPost[]>
): Promise<SourceOutcome> {
  try {
    return { status: "ok", posts: await fetcher() };
  } catch (err) {
    const reason =
      err instanceof RedditUnavailableError
        ? err.message
        : (err as Error).message || String(err);
    console.warn(`[social] ${label} unavailable: ${reason}`);
    return { status: "unavailable", reason };
  }
}

export const socialCollector: Collector = {
  source: "social",
  defaultSchedule: "0 */6 * * 1-5", // Every 6 hours on market days
  stalenessMinutes: STALENESS_MINUTES,

  async collect(symbol: string): Promise<CollectionResult> {
    const [reddit, stocktwits] = await Promise.all([
      collectSource("Reddit", () => fetchRedditPosts(symbol)),
      collectSource("StockTwits", () => fetchStocktwitsPosts(symbol)),
    ]);

    const expiresAt = new Date(Date.now() + STALENESS_MINUTES * 60 * 1000);

    // Nothing readable at all — record a skip so the missing signal is visible
    // in the UI instead of vanishing into a caught exception.
    if (reddit.status === "unavailable" && stocktwits.status === "unavailable") {
      return {
        _tag: "skipped",
        source: "social",
        reason: `No social source could be read. Reddit: ${reddit.reason} StockTwits: ${stocktwits.reason}`,
        expiresAt,
      };
    }

    // Filter Reddit posts for relevance (ticker must be in title)
    let redditPosts = reddit.status === "ok" ? reddit.posts : null;
    if (redditPosts && redditPosts.length > 0) {
      const titleFiltered = redditPosts.filter((post) =>
        tickerInTitle(post.title ?? "", symbol)
      );
      // Fall back to score-filtered posts if title filter removes everything
      if (titleFiltered.length > 0) {
        redditPosts = titleFiltered;
      }
    }

    const stocktwitsPosts = stocktwits.status === "ok" ? stocktwits.posts : null;

    const allPosts: SocialPost[] = [
      ...(redditPosts ?? []),
      ...(stocktwitsPosts ?? []),
    ];

    // Engagement score: sum of Reddit upvotes + comments across posts.
    // This varies meaningfully per ticker, unlike post count which is
    // always capped at 25 (Reddit) + 30 (StockTwits) = 55.
    const redditEngagement = redditPosts
      ? redditPosts.reduce((sum, p) => sum + (p.score ?? 0) + (p.comments ?? 0), 0)
      : null;

    return {
      source: "social",
      data: {
        symbol,
        // null means "could not be read", 0 means "read it, nobody posted".
        redditMentionCount: redditPosts?.length ?? null,
        stocktwitsMentionCount: stocktwitsPosts?.length ?? null,
        totalMentionCount: allPosts.length,
        redditEngagement,
        posts: allPosts,
        sources: {
          reddit:
            reddit.status === "ok"
              ? { status: "ok" }
              : { status: "unavailable", reason: reddit.reason },
          stocktwits:
            stocktwits.status === "ok"
              ? { status: "ok" }
              : { status: "unavailable", reason: stocktwits.reason },
        },
        fetchedAt: new Date().toISOString(),
      },
      expiresAt,
    };
  },
};
