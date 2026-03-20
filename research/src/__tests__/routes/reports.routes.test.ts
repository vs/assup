import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createMockPrisma } from "../helpers/mock-prisma.js";
import { createTestApp } from "../helpers/test-app.js";

vi.mock("../../db/index.js", () => ({
  prisma: createMockPrisma(),
}));

vi.mock("../../services/pipeline.service.js", () => ({
  pipelineService: {
    generateReport: vi.fn(),
  },
}));

import { prisma } from "../../db/index.js";
import { pipelineService } from "../../services/pipeline.service.js";
import reportsRouter from "../../routes/reports.js";

const app = createTestApp({ path: "/api/reports", router: reportsRouter });

describe("reports routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/reports/:symbol", () => {
    it("returns latest report", async () => {
      const ticker = { id: "t1", symbol: "AAPL", lastAnalyzed: null };
      const report = {
        id: "r1",
        tickerId: "t1",
        recommendation: "buy",
        summary: "Strong fundamentals",
        createdAt: new Date().toISOString(),
      };
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(ticker as any);
      vi.mocked(prisma.report.findFirst).mockResolvedValue(report as any);

      const res = await request(app).get("/api/reports/AAPL");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("recommendation", "buy");
      expect(res.body).toHaveProperty("symbol", "AAPL");
    });

    it("returns 404 when ticker not found", async () => {
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(null);

      const res = await request(app).get("/api/reports/FAKE");

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 404 when no report exists", async () => {
      const ticker = { id: "t1", symbol: "AAPL", lastAnalyzed: null };
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(ticker as any);
      vi.mocked(prisma.report.findFirst).mockResolvedValue(null);

      const res = await request(app).get("/api/reports/AAPL");

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("POST /api/reports/:symbol/generate", () => {
    it("returns 202 with jobId and status queued", async () => {
      vi.mocked(pipelineService.generateReport).mockResolvedValue("job-123");

      const res = await request(app).post("/api/reports/AAPL/generate").send({});

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ jobId: "job-123", status: "queued" });
    });

    it("passes mode option to pipeline", async () => {
      vi.mocked(pipelineService.generateReport).mockResolvedValue("job-456");

      const res = await request(app)
        .post("/api/reports/AAPL/generate")
        .send({ mode: "api" });

      expect(res.status).toBe(202);
      expect(pipelineService.generateReport).toHaveBeenCalledWith(
        "AAPL",
        expect.objectContaining({ mode: "api" })
      );
    });
  });

  describe("GET /api/reports/:symbol/history", () => {
    it("returns paginated reports", async () => {
      const ticker = { id: "t1", symbol: "AAPL", lastAnalyzed: null };
      const reports = [
        { id: "r1", tickerId: "t1", recommendation: "buy", createdAt: new Date().toISOString() },
        { id: "r2", tickerId: "t1", recommendation: "hold", createdAt: new Date().toISOString() },
      ];
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(ticker as any);
      vi.mocked(prisma.report.findMany).mockResolvedValue(reports as any);
      vi.mocked(prisma.report.count).mockResolvedValue(2);

      const res = await request(app).get("/api/reports/AAPL/history");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("reports");
      expect(res.body).toHaveProperty("total", 2);
      expect(res.body.reports).toHaveLength(2);
      expect(res.body.reports[0]).toHaveProperty("symbol", "AAPL");
    });
  });
});
