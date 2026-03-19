import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";

vi.mock("../../services/ticker.service.js", () => ({
  tickerService: {
    list: vi.fn(),
    get: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

import { tickerService } from "../../services/ticker.service.js";
import tickerRouter from "../../routes/tickers.js";

const app = createTestApp({ path: "/api/tickers", router: tickerRouter });

describe("tickers routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/tickers", () => {
    it("returns tickers list", async () => {
      const mockResult = {
        tickers: [{ id: "1", symbol: "AAPL", status: "active", source: "manual" }],
        total: 1,
      };
      vi.mocked(tickerService.list).mockResolvedValue(mockResult);

      const res = await request(app).get("/api/tickers");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockResult);
    });

    it("passes query params to service", async () => {
      vi.mocked(tickerService.list).mockResolvedValue({ tickers: [], total: 0 });

      await request(app).get("/api/tickers?status=active&page=2&limit=10");

      expect(tickerService.list).toHaveBeenCalledWith({
        status: "active",
        page: 2,
        limit: 10,
      });
    });
  });

  describe("GET /api/tickers/:symbol", () => {
    it("returns ticker details", async () => {
      const ticker = { id: "1", symbol: "AAPL", status: "active", source: "manual" };
      vi.mocked(tickerService.get).mockResolvedValue(ticker as any);

      const res = await request(app).get("/api/tickers/AAPL");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(ticker);
    });
  });

  describe("POST /api/tickers", () => {
    it("creates tickers and returns 201", async () => {
      const mockResult = {
        added: [{ id: "1", symbol: "AAPL", status: "active", source: "manual" }],
        skipped: [],
      };
      vi.mocked(tickerService.add).mockResolvedValue(mockResult as any);

      const res = await request(app)
        .post("/api/tickers")
        .send({ symbols: ["AAPL"] });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(mockResult);
      expect(tickerService.add).toHaveBeenCalledWith(["AAPL"], "manual");
    });

    it("returns 400 for invalid body", async () => {
      const res = await request(app)
        .post("/api/tickers")
        .send({ symbols: "not-an-array" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "Validation failed");
    });
  });

  describe("PATCH /api/tickers/:symbol", () => {
    it("updates ticker status", async () => {
      const updated = { id: "1", symbol: "AAPL", status: "paused", source: "manual" };
      vi.mocked(tickerService.update).mockResolvedValue(updated as any);

      const res = await request(app)
        .patch("/api/tickers/AAPL")
        .send({ status: "paused" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
      expect(tickerService.update).toHaveBeenCalledWith("AAPL", { status: "paused" });
    });
  });

  describe("DELETE /api/tickers/:symbol", () => {
    it("removes ticker and returns 204", async () => {
      vi.mocked(tickerService.remove).mockResolvedValue(undefined);

      const res = await request(app).delete("/api/tickers/AAPL");

      expect(res.status).toBe(204);
      expect(tickerService.remove).toHaveBeenCalledWith("AAPL");
    });
  });
});
