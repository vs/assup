// backend/src/__tests__/research/collectors/sa-comments.collector.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import type { CollectedData } from "../../../services/research/collectors/types.js";

vi.mock("../../../services/research/collectors/sa-rapidapi.js", () => ({
  fetchSAArticles: vi.fn(),
  fetchSACommentIds: vi.fn(),
  fetchSAComments: vi.fn(),
}));

import { saCommentsCollector } from "../../../services/research/collectors/sa-comments.collector.js";
import {
  fetchSAArticles,
  fetchSACommentIds,
  fetchSAComments,
} from "../../../services/research/collectors/sa-rapidapi.js";

const mockFetchArticles = vi.mocked(fetchSAArticles);
const mockFetchCommentIds = vi.mocked(fetchSACommentIds);
const mockFetchComments = vi.mocked(fetchSAComments);

describe("saCommentsCollector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collects articles and comments successfully", async () => {
    mockFetchArticles.mockResolvedValue([
      { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z", commentCount: 5 } },
      { id: "200", attributes: { title: "Article Two", publishOn: "2026-03-02T10:00:00Z", commentCount: 3 } },
    ]);
    mockFetchCommentIds.mockResolvedValue(["c1", "c2"]);
    mockFetchComments.mockResolvedValue([
      { id: "c1", attributes: { content: "Great analysis", createdOn: "2026-03-01T12:00:00Z", likesCount: 5 } },
      { id: "c2", attributes: { content: "I disagree", createdOn: "2026-03-01T13:00:00Z", likesCount: 2 } },
    ]);

    const result = await saCommentsCollector.collect("AAPL");
    expect(result).not.toHaveProperty("_tag");
    expect(result.source).toBe("sa_comments");

    const data = (result as CollectedData).data as any;
    expect(data.symbol).toBe("AAPL");
    expect(data.articles).toHaveLength(2);
    expect(data.articles[0].id).toBe("100");
    expect(data.articles[0].title).toBe("Article One");
    expect(data.articles[0].comments).toHaveLength(2);
    expect(data.articles[0].comments[0].content).toBe("Great analysis");
    expect(data.articles[0].comments[0].likes).toBe(5);
    expect(data.articleCount).toBe(2);
    expect(data.totalComments).toBe(4);
    expect(data.fetchedAt).toBeDefined();
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("skips articles with zero comments", async () => {
    mockFetchArticles.mockResolvedValue([
      { id: "100", attributes: { title: "Has Comments", publishOn: "2026-03-01T10:00:00Z", commentCount: 3 } },
      { id: "200", attributes: { title: "No Comments", publishOn: "2026-03-02T10:00:00Z", commentCount: 0 } },
    ]);
    mockFetchCommentIds.mockResolvedValue(["c1"]);
    mockFetchComments.mockResolvedValue([
      { id: "c1", attributes: { content: "Nice", createdOn: "2026-03-01T12:00:00Z", likesCount: 1 } },
    ]);

    const result = await saCommentsCollector.collect("AAPL");
    const data = (result as CollectedData).data as any;
    expect(data.articles).toHaveLength(1);
    expect(data.articles[0].id).toBe("100");
  });

  it("handles feed failure (returns empty articles)", async () => {
    mockFetchArticles.mockResolvedValue([]);

    const result = await saCommentsCollector.collect("AAPL");
    expect(result).not.toHaveProperty("_tag");
    expect(result.source).toBe("sa_comments");

    const data = (result as CollectedData).data as any;
    expect(data.symbol).toBe("AAPL");
    expect(data.articles).toEqual([]);
    expect(data.articleCount).toBe(0);
    expect(data.totalComments).toBe(0);
  });

  it("handles empty comment maps gracefully", async () => {
    mockFetchArticles.mockResolvedValue([
      { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z", commentCount: 2 } },
    ]);
    mockFetchCommentIds.mockResolvedValue([]);

    const result = await saCommentsCollector.collect("AAPL");
    const data = (result as CollectedData).data as any;
    expect(data.articles).toHaveLength(1);
    expect(data.articles[0].comments).toEqual([]);
    expect(data.totalComments).toBe(0);
  });

  it("caps comment IDs to 20", async () => {
    mockFetchArticles.mockResolvedValue([
      { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z", commentCount: 25 } },
    ]);
    const ids = Array.from({ length: 25 }, (_, i) => `c${i + 1}`);
    mockFetchCommentIds.mockResolvedValue(ids);
    mockFetchComments.mockResolvedValue([]);

    await saCommentsCollector.collect("AAPL");

    expect(mockFetchComments).toHaveBeenCalledWith("100", ids.slice(0, 20));
  });

  it("strips HTML tags from comment content", async () => {
    mockFetchArticles.mockResolvedValue([
      { id: "100", attributes: { title: "Article", publishOn: "2026-03-01T10:00:00Z", commentCount: 1 } },
    ]);
    mockFetchCommentIds.mockResolvedValue(["c1"]);
    mockFetchComments.mockResolvedValue([
      {
        id: "c1",
        attributes: {
          content: '$<a href="/symbol/NVDA" title="NVIDIA Corporation">NVDA</a> is a STRONG BUY &amp; hold',
          createdOn: "2026-03-01T12:00:00Z",
          likesCount: 3,
        },
      },
    ]);

    const result = await saCommentsCollector.collect("NVDA");
    const data = (result as CollectedData).data as any;
    expect(data.articles[0].comments[0].content).toBe("$NVDA is a STRONG BUY & hold");
  });

  it("handles fetchSAArticles throwing (returns empty articles)", async () => {
    mockFetchArticles.mockRejectedValue(new Error("Network error"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await saCommentsCollector.collect("AAPL");
    expect(result).not.toHaveProperty("_tag");
    expect(result.source).toBe("sa_comments");

    const data = (result as CollectedData).data as any;
    expect(data.articles).toEqual([]);
    expect(data.articleCount).toBe(0);

    expect(warnSpy).toHaveBeenCalledWith(
      "[sa_comments] Failed to fetch articles for AAPL:",
      "Network error",
    );
  });
});
