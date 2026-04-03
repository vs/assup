import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../services/research/db.js", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { prisma } from "../../../services/research/db.js";
import {
  getSAApiKey,
  setSAApiKey,
  deleteSAApiKey,
  getSAApiKeyStatus,
  fetchSAMetrics,
  fetchSAArticles,
  fetchSACommentIds,
  fetchSAComments,
  _resetCommentsCache,
} from "../../../services/research/collectors/sa-rapidapi.js";

const mockPrisma = vi.mocked(prisma);

describe("sa-rapidapi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockClear();
    _resetCommentsCache();
    delete process.env.SA_RAPIDAPI_KEY;
  });

  afterEach(() => {
    delete process.env.SA_RAPIDAPI_KEY;
  });

  describe("getSAApiKey", () => {
    it("returns key from database first", async () => {
      mockPrisma.setting.findUnique.mockResolvedValue({
        id: "1", key: "sa_rapidapi_key", value: "db-key-123", updatedAt: new Date(),
      });
      expect(await getSAApiKey()).toBe("db-key-123");
    });

    it("falls back to env var when DB has no key", async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);
      process.env.SA_RAPIDAPI_KEY = "env-key-456";
      expect(await getSAApiKey()).toBe("env-key-456");
    });

    it("returns null when neither DB nor env has key", async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);
      expect(await getSAApiKey()).toBeNull();
    });
  });

  describe("getSAApiKeyStatus", () => {
    it("returns configured from database with masked key", async () => {
      mockPrisma.setting.findUnique.mockResolvedValue({
        id: "1", key: "sa_rapidapi_key", value: "abcdefghijklmnop1234", updatedAt: new Date(),
      });
      const status = await getSAApiKeyStatus();
      expect(status.configured).toBe(true);
      expect(status.source).toBe("database");
      expect(status.maskedKey).toBe("abcdefgh...1234");
    });

    it("returns configured from environment", async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);
      process.env.SA_RAPIDAPI_KEY = "env-key-long-enough-1234";
      const status = await getSAApiKeyStatus();
      expect(status.configured).toBe(true);
      expect(status.source).toBe("environment");
    });

    it("returns not configured when no key", async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);
      const status = await getSAApiKeyStatus();
      expect(status).toEqual({ configured: false, source: "none" });
    });
  });

  describe("setSAApiKey", () => {
    it("upserts key to database", async () => {
      mockPrisma.setting.upsert.mockResolvedValue({} as any);
      await setSAApiKey("new-key");
      expect(mockPrisma.setting.upsert).toHaveBeenCalledWith({
        where: { key: "sa_rapidapi_key" },
        create: { key: "sa_rapidapi_key", value: "new-key" },
        update: { value: "new-key" },
      });
    });
  });

  describe("deleteSAApiKey", () => {
    it("deletes key from database", async () => {
      mockPrisma.setting.deleteMany.mockResolvedValue({ count: 1 });
      await deleteSAApiKey();
      expect(mockPrisma.setting.deleteMany).toHaveBeenCalledWith({
        where: { key: "sa_rapidapi_key" },
      });
    });
  });

  describe("fetchSAMetrics", () => {
    it("fetches and flattens metrics", async () => {
      mockPrisma.setting.findUnique.mockResolvedValue({
        id: "1", key: "sa_rapidapi_key", value: "test-key", updatedAt: new Date(),
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { attributes: { value: 25.5 }, relationships: { metric_type: { data: { id: "13" } } } },
            { attributes: { value: 0.65 }, relationships: { metric_type: { data: { id: "36" } } } },
          ],
          included: [
            { id: "13", type: "metric_type", attributes: { field: "pe_nongaap_fy1" } },
            { id: "36", type: "metric_type", attributes: { field: "revenue_growth" } },
          ],
        }),
      });

      const result = await fetchSAMetrics("AAPL", ["pe_nongaap_fy1", "revenue_growth"]);
      expect(result).toEqual({ pe_nongaap_fy1: 25.5, revenue_growth: 0.65 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/symbols/get-metrics");
      expect(url).toContain("symbols=aapl");
      expect(url).toContain("pe_nongaap_fy1");

      const opts = mockFetch.mock.calls[0][1] as RequestInit;
      expect(opts.headers).toMatchObject({
        "x-RapidAPI-Key": "test-key",
        "x-RapidAPI-Host": "seeking-alpha.p.rapidapi.com",
      });
    });

    it("returns null when API key is not configured", async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);
      const result = await fetchSAMetrics("AAPL", ["pe_nongaap_fy1"]);
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns null on HTTP error", async () => {
      mockPrisma.setting.findUnique.mockResolvedValue({
        id: "1", key: "sa_rapidapi_key", value: "test-key", updatedAt: new Date(),
      });
      mockFetch.mockResolvedValue({ ok: false, status: 403 });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await fetchSAMetrics("AAPL", ["pe_nongaap_fy1"]);
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("fetchSAArticles", () => {
    beforeEach(() => {
      mockPrisma.setting.findUnique.mockResolvedValue({
        id: "1", key: "sa_rapidapi_key", value: "test-key", updatedAt: new Date(),
      });
    });

    it("fetches and returns articles", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "100", attributes: { title: "Article One", publishOn: "2026-03-01T10:00:00Z", commentCount: 5 } },
            { id: "200", attributes: { title: "Article Two", publishOn: "2026-03-02T10:00:00Z", commentCount: 0 } },
          ],
        }),
      });

      const result = await fetchSAArticles("AAPL", 90);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("100");
      expect(result[0].attributes.title).toBe("Article One");
    });

    it("returns empty array when API returns null", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      const result = await fetchSAArticles("AAPL", 90);
      expect(result).toEqual([]);
    });
  });

  describe("fetchSACommentIds", () => {
    beforeEach(() => {
      mockPrisma.setting.findUnique.mockResolvedValue({
        id: "1", key: "sa_rapidapi_key", value: "test-key", updatedAt: new Date(),
      });
    });

    it("fetches comment IDs", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: "c1" }, { id: "c2" }] }),
      });

      const result = await fetchSACommentIds("100");
      expect(result).toEqual(["c1", "c2"]);
    });

    it("returns empty array on failure", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });
      const result = await fetchSACommentIds("100");
      expect(result).toEqual([]);
    });
  });

  describe("fetchSAComments", () => {
    beforeEach(() => {
      mockPrisma.setting.findUnique.mockResolvedValue({
        id: "1", key: "sa_rapidapi_key", value: "test-key", updatedAt: new Date(),
      });
    });

    it("fetches comments by article ID", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "c1", attributes: { content: "Great", createdOn: "2026-03-01T12:00:00Z", likesCount: 5 } },
          ],
        }),
      });

      const result = await fetchSAComments("100");
      expect(result).toHaveLength(1);
      expect(result[0].attributes.content).toBe("Great");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/comments/v2/list");
      expect(url).toContain("id=100");
    });
  });
});
