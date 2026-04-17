import { describe, it, expect, vi, afterEach } from "vitest";
import { socialCollector } from "../../../services/research/collectors/social.collector.js";

describe("socialCollector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct source and schedule", () => {
    expect(socialCollector.source).toBe("social");
    expect(socialCollector.stalenessMinutes).toBe(360);
  });

  it("collects from both Reddit and StockTwits", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("reddit.com")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            data: { children: [{ data: { title: "AAPL to the moon", selftext: "bullish", created_utc: Date.now() / 1000, score: 10, num_comments: 5, permalink: "/r/stocks/test", subreddit: "stocks" } }] },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          response: { status: 200 },
          messages: [{ id: 1, body: "AAPL bullish", created_at: new Date().toISOString(), user: { username: "user1" }, sentiment: { basic: "Bullish" } }],
        }),
      } as Response);
    });

    const result = await socialCollector.collect("AAPL");
    expect(result.source).toBe("social");
    expect(result.data.redditMentionCount).toBe(1);
    expect(result.data.stocktwitsMentionCount).toBe(1);
    expect(result.data.totalMentionCount).toBe(2);
    // redditEngagement = score (10) + comments (5) = 15
    expect(result.data.redditEngagement).toBe(15);
  });

  it("succeeds when only Reddit works", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("reddit.com")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ data: { children: [] } }),
        } as Response);
      }
      return Promise.reject(new Error("StockTwits down"));
    });

    const result = await socialCollector.collect("AAPL");
    expect(result.data.redditMentionCount).toBe(0);
    expect(result.data.stocktwitsMentionCount).toBe(0);
  });

  it("throws when both sources fail", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));
    await expect(socialCollector.collect("AAPL")).rejects.toThrow("Failed to fetch social data from both");
  });

  it("handles null selftext in Reddit posts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("reddit.com")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            data: { children: [{ data: { title: "Test", selftext: null, created_utc: Date.now() / 1000, score: 1, num_comments: 0, permalink: null, subreddit: "stocks" } }] },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ response: { status: 200 }, messages: [] }),
      } as Response);
    });

    const result = await socialCollector.collect("AAPL");
    expect(result.data.redditMentionCount).toBe(1);
    const posts = result.data.posts as Array<Record<string, unknown>>;
    expect(posts[0].body).toBe("");
  });

  it("uses sort=relevance for Reddit search", async () => {
    let capturedUrl = "";
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("reddit.com")) {
        capturedUrl = urlStr;
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ data: { children: [] } }),
        } as Response);
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ response: { status: 200 }, messages: [] }),
      } as Response);
    });

    await socialCollector.collect("AAPL");
    expect(capturedUrl).toContain("sort=relevance");
    expect(capturedUrl).toContain("investing");
  });

  it("filters out Reddit posts where ticker is not in the title", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("reddit.com")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            data: { children: [
              { data: { title: "AAPL earnings beat expectations", selftext: "great quarter", created_utc: Date.now() / 1000, score: 10, num_comments: 5, permalink: "/r/stocks/1", subreddit: "stocks" } },
              { data: { title: "What stocks to buy this week?", selftext: "I like AAPL and MSFT", created_utc: Date.now() / 1000, score: 20, num_comments: 10, permalink: "/r/stocks/2", subreddit: "stocks" } },
            ] },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ response: { status: 200 }, messages: [] }),
      } as Response);
    });

    const result = await socialCollector.collect("AAPL");
    const redditPosts = (result.data.posts as Array<{ source: string; title: string }>).filter(p => p.source === "reddit");
    expect(redditPosts).toHaveLength(1);
    expect(redditPosts[0].title).toContain("AAPL");
  });

  it("filters out downvoted Reddit posts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("reddit.com")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            data: { children: [
              { data: { title: "AAPL is great", selftext: "", created_utc: Date.now() / 1000, score: 5, num_comments: 2, permalink: "/r/stocks/1", subreddit: "stocks" } },
              { data: { title: "AAPL sucks", selftext: "", created_utc: Date.now() / 1000, score: -1, num_comments: 0, permalink: "/r/stocks/2", subreddit: "stocks" } },
            ] },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ response: { status: 200 }, messages: [] }),
      } as Response);
    });

    const result = await socialCollector.collect("AAPL");
    const redditPosts = (result.data.posts as Array<{ source: string; score: number }>).filter(p => p.source === "reddit");
    expect(redditPosts.every(p => p.score >= 1)).toBe(true);
  });

  it("requires $ prefix for short tickers in title match", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("reddit.com")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            data: { children: [
              { data: { title: "I bought $F calls today", selftext: "", created_utc: Date.now() / 1000, score: 5, num_comments: 2, permalink: "/r/stocks/1", subreddit: "stocks" } },
              { data: { title: "F this market honestly", selftext: "", created_utc: Date.now() / 1000, score: 10, num_comments: 5, permalink: "/r/stocks/2", subreddit: "stocks" } },
            ] },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ response: { status: 200 }, messages: [] }),
      } as Response);
    });

    const result = await socialCollector.collect("F");
    const redditPosts = (result.data.posts as Array<{ source: string; title: string }>).filter(p => p.source === "reddit");
    expect(redditPosts).toHaveLength(1);
    expect(redditPosts[0].title).toContain("$F");
  });

  it("falls back to unfiltered posts when title filter removes all results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("reddit.com")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            data: { children: [
              { data: { title: "Best stocks this week", selftext: "check out AAPL", created_utc: Date.now() / 1000, score: 5, num_comments: 2, permalink: "/r/stocks/1", subreddit: "stocks" } },
              { data: { title: "Market analysis for March", selftext: "AAPL looks good", created_utc: Date.now() / 1000, score: 8, num_comments: 3, permalink: "/r/stocks/2", subreddit: "stocks" } },
            ] },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ response: { status: 200 }, messages: [] }),
      } as Response);
    });

    const result = await socialCollector.collect("AAPL");
    const redditPosts = (result.data.posts as Array<{ source: string }>).filter(p => p.source === "reddit");
    expect(redditPosts).toHaveLength(2);
  });
});
