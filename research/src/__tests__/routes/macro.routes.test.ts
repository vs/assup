import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createMockPrisma } from "../helpers/mock-prisma.js";
import { createTestApp } from "../helpers/test-app.js";

vi.mock("../../db/index.js", () => ({
  prisma: createMockPrisma(),
}));

import { prisma } from "../../db/index.js";
import macroRouter from "../../routes/macro.js";

const app = createTestApp({ path: "/api/macro", router: macroRouter });

describe("macro routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/macro", () => {
    it("returns latest snapshot", async () => {
      const snapshot = {
        id: "1",
        regime: "risk-on",
        indicators: {},
        analyzedAt: new Date().toISOString(),
      };
      vi.mocked(prisma.macroSnapshot.findFirst).mockResolvedValue(snapshot as any);

      const res = await request(app).get("/api/macro");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("regime", "risk-on");
    });

    it("returns 404 when no snapshot exists", async () => {
      vi.mocked(prisma.macroSnapshot.findFirst).mockResolvedValue(null);

      const res = await request(app).get("/api/macro");

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("GET /api/macro/history", () => {
    it("returns paginated snapshots", async () => {
      const snapshots = [
        { id: "1", regime: "risk-on", indicators: {}, analyzedAt: new Date().toISOString() },
        { id: "2", regime: "risk-off", indicators: {}, analyzedAt: new Date().toISOString() },
      ];
      vi.mocked(prisma.macroSnapshot.findMany).mockResolvedValue(snapshots as any);
      vi.mocked(prisma.macroSnapshot.count).mockResolvedValue(2);

      const res = await request(app).get("/api/macro/history");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ snapshots, total: 2 });
    });
  });
});
