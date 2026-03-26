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
});
