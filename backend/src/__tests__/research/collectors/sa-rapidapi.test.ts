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
  fetchSAComments,
} from "../../../services/research/collectors/sa-rapidapi.js";

const mockPrisma = vi.mocked(prisma);

function mockApiKey() {
  mockPrisma.setting.findUnique.mockResolvedValue({
    id: "1", key: "sa_rapidapi_key", value: "test-key", updatedAt: new Date(),
  });
}

describe("sa-rapidapi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockClear();
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
      mockApiKey();
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
      mockApiKey();
      mockFetch.mockResolvedValue({ ok: false, status: 403 });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await fetchSAMetrics("AAPL", ["pe_nongaap_fy1"]);
      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("fetchSAArticles", () => {
    it("fetches articles via /analysis/v2/list with ticker as id", async () => {
      mockApiKey();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "100", attributes: { title: "AAPL Analysis", publishOn: "2026-03-01T10:00:00Z", commentCount: 5 } },
          ],
        }),
      });

      const result = await fetchSAArticles("AAPL", 90);
      expect(result).toHaveLength(1);
      expect(result[0].attributes.title).toBe("AAPL Analysis");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/analysis/v2/list");
      expect(url).toContain("id=aapl");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns empty array on HTTP error", async () => {
      mockApiKey();
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await fetchSAArticles("AAPL", 90);
      expect(result).toEqual([]);
    });

    it("returns empty array when no API key", async () => {
      mockPrisma.setting.findUnique.mockResolvedValue(null);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await fetchSAArticles("AAPL", 90);
      expect(result).toEqual([]);
    });
  });

  describe("fetchSAComments", () => {
    it("fetches comment list then content via two API calls", async () => {
      mockApiKey();
      // First call: comments/v2/list returns IDs (no content)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: "c1", attributes: { createdOn: "2026-03-01T12:00:00Z", likesCount: 5 } },
            { id: "c2", attributes: { createdOn: "2026-03-01T13:00:00Z", likesCount: 2 } },
          ],
        }),
      });
      // Second call: comments/get-contents returns actual content
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: "c1", attributes: { content: "Great analysis", createdOn: "2026-03-01T12:00:00Z", likesCount: 5 } },
            { id: "c2", attributes: { content: "I disagree", createdOn: "2026-03-01T13:00:00Z", likesCount: 2 } },
          ],
        }),
      });

      const result = await fetchSAComments("100");
      expect(result).toHaveLength(2);
      expect(result[0].attributes.content).toBe("Great analysis");
      expect(result[1].attributes.content).toBe("I disagree");

      // Verify first call is comments/v2/list
      const listUrl = mockFetch.mock.calls[0][0] as string;
      expect(listUrl).toContain("/comments/v2/list");
      expect(listUrl).toContain("id=100");

      // Verify second call is comments/get-contents with comment IDs
      const contentsUrl = mockFetch.mock.calls[1][0] as string;
      expect(contentsUrl).toContain("/comments/get-contents");
      expect(contentsUrl).toContain("id=100");
      expect(contentsUrl).toContain("comment_ids=c1");
      expect(contentsUrl).toContain("comment_ids=c2");
    });

    it("returns empty array when no comments listed", async () => {
      mockApiKey();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const result = await fetchSAComments("100");
      expect(result).toEqual([]);
      // Should not make a second call
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns empty array when list call fails", async () => {
      mockApiKey();
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await fetchSAComments("999");
      expect(result).toEqual([]);
    });
  });
});
