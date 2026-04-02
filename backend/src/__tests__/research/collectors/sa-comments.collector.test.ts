import { describe, it, expect, vi, afterEach } from "vitest";
import type { CollectedData } from "../../../services/research/collectors/types.js";

vi.mock("../../../services/research/collectors/sa-browser.js", () => ({
  fetchSAJson: vi.fn(),
}));

// Mock execFile so wget fallback doesn't actually run in tests
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(new Error("wget not available in test"), "", "");
  }),
}));

import { saCommentsCollector } from "../../../services/research/collectors/sa-comments.collector.js";
import { fetchSAJson } from "../../../services/research/collectors/sa-browser.js";

const mockFetchSA = vi.mocked(fetchSAJson);

describe("saCommentsCollector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collects articles and comments successfully", async () => {
    mockFetchSA.mockImplementation(async (url: string) => {
      if (url.includes("/api/v3/feed")) {
        return {
          data: [
            { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z", commentCount: 5 } },
            { id: "200", attributes: { title: "Article Two", publishOn: "2026-03-02T10:00:00Z", commentCount: 3 } },
          ],
        };
      }
      if (url.includes("/comment_maps")) {
        return { data: [{ id: "c1" }, { id: "c2" }] };
      }
      if (url.includes("/comments")) {
        return {
          data: [
            { id: "c1", attributes: { content: "Great analysis", createdOn: "2026-03-01T12:00:00Z", likesCount: 5 } },
            { id: "c2", attributes: { content: "I disagree", createdOn: "2026-03-01T13:00:00Z", likesCount: 2 } },
          ],
        };
      }
      return null;
    });

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
    mockFetchSA.mockImplementation(async (url: string) => {
      if (url.includes("/api/v3/feed")) {
        return {
          data: [
            { id: "100", attributes: { title: "Has Comments", publishOn: "2026-03-01T10:00:00Z", commentCount: 3 } },
            { id: "200", attributes: { title: "No Comments", publishOn: "2026-03-02T10:00:00Z", commentCount: 0 } },
          ],
        };
      }
      if (url.includes("/comment_maps")) {
        return { data: [{ id: "c1" }] };
      }
      if (url.includes("/comments")) {
        return {
          data: [{ id: "c1", attributes: { content: "Nice", createdOn: "2026-03-01T12:00:00Z", likesCount: 1 } }],
        };
      }
      return null;
    });

    const result = await saCommentsCollector.collect("AAPL");
    const data = (result as CollectedData).data as any;
    expect(data.articles).toHaveLength(1);
    expect(data.articles[0].id).toBe("100");
  });

  it("handles feed endpoint failure (returns empty articles, no throw)", async () => {
    mockFetchSA.mockResolvedValue(null);

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
    mockFetchSA.mockImplementation(async (url: string) => {
      if (url.includes("/api/v3/feed")) {
        return {
          data: [
            { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z", commentCount: 2 } },
          ],
        };
      }
      if (url.includes("/comment_maps")) {
        return { data: [] };
      }
      return null;
    });

    const result = await saCommentsCollector.collect("AAPL");
    const data = (result as CollectedData).data as any;
    expect(data.articles).toHaveLength(1);
    expect(data.articles[0].comments).toEqual([]);
    expect(data.totalComments).toBe(0);
  });

  it("caps comment IDs to 20 when comment-maps returns more", async () => {
    const commentMapIds = Array.from({ length: 25 }, (_, i) => ({ id: `c${i + 1}` }));

    mockFetchSA.mockImplementation(async (url: string) => {
      if (url.includes("/api/v3/feed")) {
        return {
          data: [
            { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z", commentCount: 25 } },
          ],
        };
      }
      if (url.includes("/comment_maps")) {
        return { data: commentMapIds };
      }
      if (url.includes("/comments")) {
        // Verify only 20 comment IDs are passed using bracket array syntax
        const idMatches = url.match(/comment_ids\[\]=/g);
        expect(idMatches).toHaveLength(20);
        return { data: [] };
      }
      return null;
    });

    const result = await saCommentsCollector.collect("AAPL");
    const data = (result as CollectedData).data as any;
    expect(data.articles).toHaveLength(1);
  });

  it("strips HTML tags from comment content", async () => {
    mockFetchSA.mockImplementation(async (url: string) => {
      if (url.includes("/api/v3/feed")) {
        return {
          data: [
            { id: "100", attributes: { title: "Article", publishOn: "2026-03-01T10:00:00Z", commentCount: 1 } },
          ],
        };
      }
      if (url.includes("/comment_maps")) {
        return { data: [{ id: "c1" }] };
      }
      if (url.includes("/comments")) {
        return {
          data: [
            {
              id: "c1",
              attributes: {
                content: '$<a href="/symbol/NVDA" title="NVIDIA Corporation">NVDA</a> is a STRONG BUY &amp; hold',
                createdOn: "2026-03-01T12:00:00Z",
                likesCount: 3,
              },
            },
          ],
        };
      }
      return null;
    });

    const result = await saCommentsCollector.collect("NVDA");
    const data = (result as CollectedData).data as any;
    expect(data.articles[0].comments[0].content).toBe("$NVDA is a STRONG BUY & hold");
  });

  it("handles fetchSAJson throwing (returns empty articles, no throw)", async () => {
    mockFetchSA.mockRejectedValue(new Error("Browser crashed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await saCommentsCollector.collect("AAPL");
    expect(result).not.toHaveProperty("_tag");
    expect(result.source).toBe("sa_comments");

    const data = (result as CollectedData).data as any;
    expect(data.symbol).toBe("AAPL");
    expect(data.articles).toEqual([]);
    expect(data.articleCount).toBe(0);
    expect(data.totalComments).toBe(0);

    expect(warnSpy).toHaveBeenCalledWith(
      "[sa_comments] Failed to fetch articles for AAPL:",
      "Browser crashed",
    );
  });
});
