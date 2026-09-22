import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// reddit-auth pulls in prisma, so it is replaced wholesale rather than
// partially mocked — the collector only needs redditFetch and the error type.
const { redditFetch, RedditUnavailableError } = vi.hoisted(() => {
  class RedditUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "RedditUnavailableError";
    }
  }
  return { redditFetch: vi.fn(), RedditUnavailableError };
});

vi.mock("../../../services/research/collectors/reddit-auth.js", () => ({
  redditFetch,
  RedditUnavailableError,
}));

import { socialCollector } from "../../../services/research/collectors/social.collector.js";
import {
  isSkipped,
  type CollectedData,
} from "../../../services/research/collectors/types.js";

/** Narrow a collect() result to a successful collection, failing the test otherwise. */
async function collectOk(symbol: string): Promise<CollectedData> {
  const result = await socialCollector.collect(symbol);
  if (isSkipped(result)) {
    throw new Error(`expected a collection, got skip: ${result.reason}`);
  }
  return result;
}

function post(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      title: "AAPL to the moon",
      selftext: "bullish",
      created_utc: Date.now() / 1000,
      score: 10,
      num_comments: 5,
      permalink: "/r/stocks/test",
      subreddit: "stocks",
      ...overrides,
    },
  };
}

function redditReturns(children: unknown[]) {
  redditFetch.mockResolvedValue({ data: { children } });
}

function stocktwitsReturns(messages: unknown[]) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ response: { status: 200 }, messages }),
  } as Response);
}

function stocktwitsBlocked() {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status: 403,
    statusText: "Forbidden",
    json: () => Promise.resolve({}),
  } as Response);
}

const stMessage = {
  id: 1,
  body: "AAPL bullish",
  created_at: new Date().toISOString(),
  user: { username: "user1" },
  sentiment: { basic: "Bullish" },
};

describe("socialCollector", () => {
  beforeEach(() => {
    redditFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct source and schedule", () => {
    expect(socialCollector.source).toBe("social");
    expect(socialCollector.stalenessMinutes).toBe(360);
  });

  it("collects from both Reddit and StockTwits", async () => {
    redditReturns([post()]);
    stocktwitsReturns([stMessage]);

    const result = await collectOk("AAPL");

    expect(result.source).toBe("social");
    expect(result.data.redditMentionCount).toBe(1);
    expect(result.data.stocktwitsMentionCount).toBe(1);
    expect(result.data.totalMentionCount).toBe(2);
    // redditEngagement = score (10) + comments (5) = 15
    expect(result.data.redditEngagement).toBe(15);
  });

  it("reads Reddit through the authenticated OAuth client", async () => {
    redditReturns([]);
    stocktwitsReturns([]);

    await collectOk("AAPL");

    const path = redditFetch.mock.calls[0][0] as string;
    expect(path).toContain("sort=relevance");
    expect(path).toContain("investing");
    expect(path).toContain("q=AAPL");
  });

  it("marks an unreadable source null rather than scoring it as zero", async () => {
    redditReturns([post()]);
    stocktwitsBlocked();

    const result = await collectOk("AAPL");

    expect(result.data.redditMentionCount).toBe(1);
    expect(result.data.stocktwitsMentionCount).toBeNull();
    const sources = result.data.sources as Record<string, { status: string; reason?: string }>;
    expect(sources.stocktwits.status).toBe("unavailable");
    expect(sources.stocktwits.reason).toContain("403");
    expect(sources.reddit.status).toBe("ok");
  });

  it("distinguishes an empty source from an unreadable one", async () => {
    redditReturns([]);
    stocktwitsReturns([]);

    const result = await collectOk("AAPL");

    expect(result.data.redditMentionCount).toBe(0);
    expect(result.data.stocktwitsMentionCount).toBe(0);
  });

  it("records a skip with both reasons when no source can be read", async () => {
    redditFetch.mockRejectedValue(
      new RedditUnavailableError("Reddit API credentials are not configured")
    );
    stocktwitsBlocked();

    const result = await socialCollector.collect("AAPL");

    expect(isSkipped(result)).toBe(true);
    if (!isSkipped(result)) throw new Error("unreachable");
    expect(result.source).toBe("social");
    expect(result.reason).toContain("credentials are not configured");
    expect(result.reason).toContain("403");
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("handles null selftext in Reddit posts", async () => {
    redditReturns([
      post({ title: "Test AAPL", selftext: null, score: 1, num_comments: 0, permalink: null }),
    ]);
    stocktwitsReturns([]);

    const result = await collectOk("AAPL");

    expect(result.data.redditMentionCount).toBe(1);
    const posts = result.data.posts as Array<Record<string, unknown>>;
    expect(posts[0].body).toBe("");
  });

  it("filters out Reddit posts where ticker is not in the title", async () => {
    redditReturns([
      post({ title: "AAPL earnings beat expectations" }),
      post({ title: "What stocks to buy this week?", score: 20, num_comments: 10 }),
    ]);
    stocktwitsReturns([]);

    const result = await collectOk("AAPL");

    const redditPosts = (
      result.data.posts as Array<{ source: string; title: string }>
    ).filter((p) => p.source === "reddit");
    expect(redditPosts).toHaveLength(1);
    expect(redditPosts[0].title).toContain("AAPL");
  });

  it("filters out downvoted Reddit posts", async () => {
    redditReturns([
      post({ title: "AAPL is great", score: 5, num_comments: 2 }),
      post({ title: "AAPL sucks", score: -1, num_comments: 0 }),
    ]);
    stocktwitsReturns([]);

    const result = await collectOk("AAPL");

    const redditPosts = (
      result.data.posts as Array<{ source: string; score: number }>
    ).filter((p) => p.source === "reddit");
    expect(redditPosts.every((p) => p.score >= 1)).toBe(true);
  });

  it("requires $ prefix for short tickers in title match", async () => {
    redditReturns([
      post({ title: "I bought $F calls today", score: 5, num_comments: 2 }),
      post({ title: "F this market honestly", score: 10, num_comments: 5 }),
    ]);
    stocktwitsReturns([]);

    const result = await collectOk("F");

    const redditPosts = (
      result.data.posts as Array<{ source: string; title: string }>
    ).filter((p) => p.source === "reddit");
    expect(redditPosts).toHaveLength(1);
    expect(redditPosts[0].title).toContain("$F");
  });

  it("falls back to unfiltered posts when title filter removes all results", async () => {
    redditReturns([
      post({ title: "Best stocks this week", score: 5, num_comments: 2 }),
      post({ title: "Market analysis for March", score: 8, num_comments: 3 }),
    ]);
    stocktwitsReturns([]);

    const result = await collectOk("AAPL");

    const redditPosts = (
      result.data.posts as Array<{ source: string }>
    ).filter((p) => p.source === "reddit");
    expect(redditPosts).toHaveLength(2);
  });
});
