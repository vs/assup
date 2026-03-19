import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";

vi.mock("../../services/job.service.js", () => ({
  jobService: {
    list: vi.fn(),
    get: vi.fn(),
  },
}));

import { jobService } from "../../services/job.service.js";
import jobsRouter from "../../routes/jobs.js";

const app = createTestApp({ path: "/api/jobs", router: jobsRouter });

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("jobs routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/jobs", () => {
    it("returns jobs list", async () => {
      const jobs = [
        { id: VALID_UUID, type: "analysis", status: "completed", symbol: "AAPL" },
      ];
      vi.mocked(jobService.list).mockResolvedValue(jobs as any);

      const res = await request(app).get("/api/jobs");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(jobs);
    });
  });

  describe("GET /api/jobs/:jobId", () => {
    it("returns job details", async () => {
      const job = { id: VALID_UUID, type: "analysis", status: "completed", symbol: "AAPL" };
      vi.mocked(jobService.get).mockResolvedValue(job as any);

      const res = await request(app).get(`/api/jobs/${VALID_UUID}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(job);
    });

    it("returns 404 for unknown job", async () => {
      vi.mocked(jobService.get).mockResolvedValue(null);

      const res = await request(app).get(`/api/jobs/${VALID_UUID}`);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await request(app).get("/api/jobs/not-a-uuid");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "Validation failed");
    });
  });
});
