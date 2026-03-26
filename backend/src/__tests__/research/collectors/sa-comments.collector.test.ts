import { describe, it, expect, vi, afterEach } from "vitest";
import { saCommentsCollector } from "../../../services/research/collectors/sa-comments.collector.js";
import type { CollectedData } from "../../../services/research/collectors/types.js";

describe("saCommentsCollector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("collects articles and comments successfully", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("/api/v3/feed")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z", commentCount: 5 } },
                { id: "200", attributes: { title: "Article Two", publishOn: "2026-03-02T10:00:00Z", commentCount: 3 } },
              ],
            }),
        } as Response);
      }

      if (urlStr.includes("/comment_maps")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: "c1" }, { id: "c2" }] }),
        } as Response);
      }

      if (urlStr.includes("/comments")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "c1", attributes: { content: "Great analysis", createdOn: "2026-03-01T12:00:00Z", likesCount: 5 } },
                { id: "c2", attributes: { content: "I disagree", createdOn: "2026-03-01T13:00:00Z", likesCount: 2 } },
              ],
            }),
        } as Response);
      }

      return Promise.resolve({ ok: false, status: 404 } as Response);
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
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("/api/v3/feed")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "100", attributes: { title: "Has Comments", publishOn: "2026-03-01T10:00:00Z", commentCount: 3 } },
                { id: "200", attributes: { title: "No Comments", publishOn: "2026-03-02T10:00:00Z", commentCount: 0 } },
              ],
            }),
        } as Response);
      }

      if (urlStr.includes("/comment_maps")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: "c1" }] }),
        } as Response);
      }

      if (urlStr.includes("/comments")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [{ id: "c1", attributes: { content: "Nice", createdOn: "2026-03-01T12:00:00Z", likesCount: 1 } }],
            }),
        } as Response);
      }

      return Promise.resolve({ ok: false, status: 404 } as Response);
    });

    const result = await saCommentsCollector.collect("AAPL");
    const data = (result as CollectedData).data as any;
    expect(data.articles).toHaveLength(1);
    expect(data.articles[0].id).toBe("100");
  });

  it("handles feed endpoint failure (returns empty articles, no throw)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);

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
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("/api/v3/feed")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z", commentCount: 2 } },
              ],
            }),
        } as Response);
      }

      if (urlStr.includes("/comment_maps")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] }),
        } as Response);
      }

      return Promise.resolve({ ok: false, status: 404 } as Response);
    });

    const result = await saCommentsCollector.collect("AAPL");
    const data = (result as CollectedData).data as any;
    expect(data.articles).toHaveLength(1);
    expect(data.articles[0].comments).toEqual([]);
    expect(data.totalComments).toBe(0);
  });

  it("caps comment IDs to 20 when comment-maps returns more", async () => {
    const commentMapIds = Array.from({ length: 25 }, (_, i) => ({ id: `c${i + 1}` }));

    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("/api/v3/feed")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z", commentCount: 25 } },
              ],
            }),
        } as Response);
      }

      if (urlStr.includes("/comment_maps")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: commentMapIds }),
        } as Response);
      }

      if (urlStr.includes("/comments")) {
        // Verify only 20 comment IDs are passed using bracket array syntax
        const idMatches = urlStr.match(/comment_ids\[\]=/g);
        expect(idMatches).toHaveLength(20);

        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] }),
        } as Response);
      }

      return Promise.resolve({ ok: false, status: 404 } as Response);
    });

    const result = await saCommentsCollector.collect("AAPL");
    const data = (result as CollectedData).data as any;
    expect(data.articles).toHaveLength(1);
  });

  it("strips HTML tags from comment content", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("/api/v3/feed")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "100", attributes: { title: "Article", publishOn: "2026-03-01T10:00:00Z", commentCount: 1 } },
              ],
            }),
        } as Response);
      }

      if (urlStr.includes("/comment_maps")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: "c1" }] }),
        } as Response);
      }

      if (urlStr.includes("/comments")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
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
            }),
        } as Response);
      }

      return Promise.resolve({ ok: false, status: 404 } as Response);
    });

    const result = await saCommentsCollector.collect("NVDA");
    const data = (result as CollectedData).data as any;
    expect(data.articles[0].comments[0].content).toBe("$NVDA is a STRONG BUY & hold");
  });

  it("handles fetch throwing a network error (returns empty articles, no throw)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network failure"));
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
      "Network failure",
    );
  });
});
