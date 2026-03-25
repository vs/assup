import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { saCommentsCollector } from "../../collectors/sa-comments.collector.js";
import type { SkippedCollection, CollectedData } from "../../collectors/types.js";

describe("saCommentsCollector", () => {
  const originalEnv = process.env.SEEKING_ALPHA_API_KEY;

  beforeEach(() => {
    process.env.SEEKING_ALPHA_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.SEEKING_ALPHA_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns SkippedCollection when API key not set", async () => {
    delete process.env.SEEKING_ALPHA_API_KEY;
    const result = await saCommentsCollector.collect("AAPL");
    expect(result).toMatchObject({
      _tag: "skipped",
      source: "sa_comments",
      reason: "SEEKING_ALPHA_API_KEY not configured",
    });
    expect((result as SkippedCollection).expiresAt).toBeInstanceOf(Date);
  });

  it("collects articles and comments successfully", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("/v1/symbols/analysis")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z" } },
                { id: "200", attributes: { title: "Article Two", publishOn: "2026-03-02T10:00:00Z" } },
              ],
            }),
        } as Response);
      }

      if (urlStr.includes("/v1/articles/comment-maps")) {
        const articleId = new URL(urlStr).searchParams.get("article_id");
        if (articleId === "100") {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: [{ id: "c1" }, { id: "c2" }] }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: "c3" }] }),
        } as Response);
      }

      if (urlStr.includes("/v1/articles/comments")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "c1", attributes: { content: "Great analysis", created_at: "2026-03-01T12:00:00Z", likes_count: 5 } },
                { id: "c2", attributes: { content: "I disagree", created_at: "2026-03-01T13:00:00Z", likes_count: 2 } },
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
    expect(data.totalComments).toBe(4); // 2 + 2 (mock returns same 2 comments for both articles)
    expect(data.fetchedAt).toBeDefined();
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("handles analysis endpoint failure (returns empty articles, no throw)", async () => {
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

      if (urlStr.includes("/v1/symbols/analysis")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z" } },
              ],
            }),
        } as Response);
      }

      if (urlStr.includes("/v1/articles/comment-maps")) {
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

  it("caps articles to 3 even when API returns more", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("/v1/symbols/analysis")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "1", attributes: { title: "Art 1", publishOn: "2026-03-01T10:00:00Z" } },
                { id: "2", attributes: { title: "Art 2", publishOn: "2026-03-01T11:00:00Z" } },
                { id: "3", attributes: { title: "Art 3", publishOn: "2026-03-01T12:00:00Z" } },
                { id: "4", attributes: { title: "Art 4", publishOn: "2026-03-01T13:00:00Z" } },
                { id: "5", attributes: { title: "Art 5", publishOn: "2026-03-01T14:00:00Z" } },
              ],
            }),
        } as Response);
      }

      if (urlStr.includes("/v1/articles/comment-maps")) {
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
    expect(data.articles).toHaveLength(3);
    expect(data.articleCount).toBe(3);
  });

  it("caps comment IDs to 20 when comment-maps returns more", async () => {
    const commentMapIds = Array.from({ length: 25 }, (_, i) => ({ id: `c${i + 1}` }));

    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();

      if (urlStr.includes("/v1/symbols/analysis")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z" } },
              ],
            }),
        } as Response);
      }

      if (urlStr.includes("/v1/articles/comment-maps")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: commentMapIds }),
        } as Response);
      }

      if (urlStr.includes("/v1/articles/comments")) {
        // Verify only 20 comment IDs are passed in the URL
        const parsedUrl = new URL(urlStr);
        const ids = parsedUrl.searchParams.get("comment_ids")!.split(",");
        expect(ids).toHaveLength(20);
        expect(ids[0]).toBe("c1");
        expect(ids[19]).toBe("c20");

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
});
