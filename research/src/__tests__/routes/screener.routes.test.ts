import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";

vi.mock("../../services/screener.service.js", () => ({
  screenerService: {
    listConfigs: vi.fn(),
    createConfig: vi.fn(),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    deleteConfig: vi.fn(),
    getResults: vi.fn(),
    runScreener: vi.fn(),
  },
}));

vi.mock("../../services/job.service.js", () => ({
  jobService: {
    create: vi.fn(),
    start: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  },
}));

vi.mock("../../services/scheduler.service.js", () => ({
  schedulerService: {
    refreshScreenerSchedules: vi.fn(),
  },
}));

import { screenerService } from "../../services/screener.service.js";
import { jobService } from "../../services/job.service.js";
import screenerRouter from "../../routes/screener.js";

const app = createTestApp({ path: "/api/screener", router: screenerRouter });

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("screener routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/screener/configs", () => {
    it("returns all configs", async () => {
      vi.mocked(screenerService.listConfigs).mockResolvedValue([]);

      const res = await request(app).get("/api/screener/configs");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("POST /api/screener/configs", () => {
    it("creates config and returns 201", async () => {
      const newConfig = {
        id: VALID_UUID,
        name: "Tech Screener",
        criteria: { market: "US", maxResults: 10 },
        schedule: "0 9 * * 1-5",
        enabled: true,
      };
      vi.mocked(screenerService.createConfig).mockResolvedValue(newConfig as any);

      const res = await request(app)
        .post("/api/screener/configs")
        .send({
          name: "Tech Screener",
          criteria: { market: "US", maxResults: 10 },
          schedule: "0 9 * * 1-5",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("name", "Tech Screener");
    });
  });

  describe("POST /api/screener/configs/:id/run", () => {
    it("returns 202 with jobId", async () => {
      const config = { id: VALID_UUID, name: "Tech Screener", criteria: {}, schedule: "0 9 * * 1-5" };
      const job = { id: "job-456" };
      vi.mocked(screenerService.getConfig).mockResolvedValue(config as any);
      vi.mocked(jobService.create).mockResolvedValue(job as any);
      vi.mocked(jobService.start).mockResolvedValue(undefined as any);
      vi.mocked(screenerService.runScreener).mockResolvedValue({ discovered: [], added: [], skipped: [] });
      vi.mocked(jobService.complete).mockResolvedValue(undefined as any);

      const res = await request(app).post(`/api/screener/configs/${VALID_UUID}/run`);

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ jobId: "job-456" });
    });
  });

  describe("DELETE /api/screener/configs/:id", () => {
    it("returns 204 on success", async () => {
      vi.mocked(screenerService.deleteConfig).mockResolvedValue(undefined);

      const res = await request(app).delete(`/api/screener/configs/${VALID_UUID}`);

      expect(res.status).toBe(204);
    });
  });

  describe("GET /api/screener/results", () => {
    it("returns paginated results", async () => {
      const results = {
        tickers: [{ symbol: "AAPL", addedAt: new Date().toISOString(), status: "active" }],
        total: 1,
      };
      vi.mocked(screenerService.getResults).mockResolvedValue(results as any);

      const res = await request(app).get("/api/screener/results");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("tickers");
      expect(res.body).toHaveProperty("total", 1);
    });
  });
});
