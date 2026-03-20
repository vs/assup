import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createMockPrisma } from "../helpers/mock-prisma.js";
import { createTestApp } from "../helpers/test-app.js";

vi.mock("../../db/index.js", () => ({
  prisma: createMockPrisma(),
}));

import { prisma } from "../../db/index.js";
import analysisRouter from "../../routes/analysis.js";

const app = createTestApp({ path: "/api/analysis", router: analysisRouter });

describe("analysis routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/analysis/:symbol", () => {
    it("returns latest analyses per source and collection statuses", async () => {
      const ticker = { id: "t1", symbol: "AAPL", lastAnalyzed: new Date().toISOString() };
      const analyses = [
        { id: "a1", tickerId: "t1", source: "technical", signal: "bullish", confidence: 0.8, summary: "Uptrend" },
        { id: "a2", tickerId: "t1", source: "options", signal: "neutral", confidence: 0.5, summary: "Mixed" },
      ];
      const skippedStatuses = [
        { source: "short_interest", status: "skipped", skipReason: "Polygon API returned 404", collectedAt: new Date() },
      ];
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(ticker as any);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce(analyses as any)
        .mockResolvedValueOnce(skippedStatuses as any);

      const res = await request(app).get("/api/analysis/AAPL");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("symbol", "AAPL");
      expect(res.body).toHaveProperty("analyses");
      expect(res.body.analyses).toHaveLength(2);
      expect(res.body).toHaveProperty("collectionStatuses");
      expect(res.body.collectionStatuses).toHaveLength(1);
      expect(res.body.collectionStatuses[0]).toMatchObject({
        source: "short_interest",
        status: "skipped",
        skipReason: "Polygon API returned 404",
      });
    });

    it("returns empty collectionStatuses when none skipped", async () => {
      const ticker = { id: "t1", symbol: "AAPL", lastAnalyzed: new Date().toISOString() };
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(ticker as any);
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([] as any)
        .mockResolvedValueOnce([] as any);

      const res = await request(app).get("/api/analysis/AAPL");

      expect(res.status).toBe(200);
      expect(res.body.collectionStatuses).toEqual([]);
    });

    it("returns 404 for unknown ticker", async () => {
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(null);

      const res = await request(app).get("/api/analysis/FAKE");

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("GET /api/analysis/:symbol/:source", () => {
    it("returns latest analysis for specific source", async () => {
      const ticker = { id: "t1", symbol: "AAPL", lastAnalyzed: new Date().toISOString() };
      const analysis = {
        id: "a1",
        tickerId: "t1",
        source: "technical",
        signal: "bullish",
        confidence: 0.8,
        summary: "Uptrend",
        analyzedAt: new Date().toISOString(),
      };
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(ticker as any);
      vi.mocked(prisma.analysis.findFirst).mockResolvedValue(analysis as any);

      const res = await request(app).get("/api/analysis/AAPL/technical");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("source", "technical");
      expect(res.body).toHaveProperty("signal", "bullish");
    });

    it("returns 404 when no analysis exists", async () => {
      const ticker = { id: "t1", symbol: "AAPL", lastAnalyzed: null };
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(ticker as any);
      vi.mocked(prisma.analysis.findFirst).mockResolvedValue(null);

      const res = await request(app).get("/api/analysis/AAPL/technical");

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
    });
  });
});
