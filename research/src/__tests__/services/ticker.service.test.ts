import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../helpers/mock-prisma.js";

vi.mock("../../db/index.js", () => ({
  prisma: createMockPrisma(),
}));

import { prisma } from "../../db/index.js";
import { tickerService } from "../../services/ticker.service.js";

describe("tickerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("returns tickers and total count", async () => {
      const tickers = [{ id: "1", symbol: "AAPL", status: "active", source: "manual", addedAt: new Date(), lastAnalyzed: null }];
      vi.mocked(prisma.ticker.findMany).mockResolvedValue(tickers);
      vi.mocked(prisma.ticker.count).mockResolvedValue(1);

      const result = await tickerService.list({ page: 1, limit: 50 });
      expect(result.tickers).toEqual(tickers);
      expect(result.total).toBe(1);
    });

    it("applies status and source filters", async () => {
      vi.mocked(prisma.ticker.findMany).mockResolvedValue([]);
      vi.mocked(prisma.ticker.count).mockResolvedValue(0);

      await tickerService.list({ status: "active", source: "manual", page: 1, limit: 50 });
      expect(prisma.ticker.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: "active", source: "manual" } })
      );
    });

    it("paginates correctly", async () => {
      vi.mocked(prisma.ticker.findMany).mockResolvedValue([]);
      vi.mocked(prisma.ticker.count).mockResolvedValue(0);

      await tickerService.list({ page: 3, limit: 10 });
      expect(prisma.ticker.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 })
      );
    });
  });

  describe("get", () => {
    it("returns ticker when found", async () => {
      const ticker = { id: "1", symbol: "AAPL", status: "active", source: "manual", addedAt: new Date(), lastAnalyzed: null };
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(ticker);

      const result = await tickerService.get("AAPL");
      expect(result).toEqual(ticker);
    });

    it("throws NotFoundError when not found", async () => {
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(null);
      await expect(tickerService.get("FAKE")).rejects.toThrow("not found");
    });
  });

  describe("add", () => {
    it("creates new tickers", async () => {
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.ticker.create).mockImplementation(({ data }: any) =>
        Promise.resolve({ id: "1", ...data, addedAt: new Date(), lastAnalyzed: null, status: "active" })
      );

      const result = await tickerService.add(["AAPL", "GOOG"], "manual");
      expect(result.added).toHaveLength(2);
      expect(result.skipped).toHaveLength(0);
    });

    it("skips already-existing active tickers", async () => {
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue({
        id: "1", symbol: "AAPL", status: "active", source: "manual", addedAt: new Date(), lastAnalyzed: null,
      });

      const result = await tickerService.add(["AAPL"], "manual");
      expect(result.added).toHaveLength(0);
      expect(result.skipped).toEqual(["AAPL"]);
    });

    it("reactivates removed tickers", async () => {
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue({
        id: "1", symbol: "AAPL", status: "removed", source: "manual", addedAt: new Date(), lastAnalyzed: null,
      });
      vi.mocked(prisma.ticker.update).mockResolvedValue({
        id: "1", symbol: "AAPL", status: "active", source: "external", addedAt: new Date(), lastAnalyzed: null,
      });

      const result = await tickerService.add(["AAPL"], "external");
      expect(result.added).toHaveLength(1);
      expect(prisma.ticker.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "active", source: "external" } })
      );
    });

    it("catches P2002 unique constraint (concurrent adds)", async () => {
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(null);
      const p2002Error = Object.assign(new Error("Unique constraint"), { code: "P2002" });
      vi.mocked(prisma.ticker.create).mockRejectedValue(p2002Error);

      const result = await tickerService.add(["AAPL"], "manual");
      expect(result.added).toHaveLength(0);
      expect(result.skipped).toEqual(["AAPL"]);
    });

    it("rethrows non-P2002 errors", async () => {
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.ticker.create).mockRejectedValue(new Error("DB connection failed"));

      await expect(tickerService.add(["AAPL"], "manual")).rejects.toThrow("DB connection failed");
    });
  });

  describe("update", () => {
    it("updates ticker status", async () => {
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue({ id: "1", symbol: "AAPL", status: "active", source: "manual", addedAt: new Date(), lastAnalyzed: null });
      vi.mocked(prisma.ticker.update).mockResolvedValue({ id: "1", symbol: "AAPL", status: "paused", source: "manual", addedAt: new Date(), lastAnalyzed: null });

      const result = await tickerService.update("AAPL", { status: "paused" });
      expect(result.status).toBe("paused");
    });

    it("throws NotFoundError for unknown symbol", async () => {
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(null);
      await expect(tickerService.update("FAKE", { status: "paused" })).rejects.toThrow("not found");
    });
  });

  describe("remove", () => {
    it("deletes ticker", async () => {
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue({ id: "1", symbol: "AAPL", status: "active", source: "manual", addedAt: new Date(), lastAnalyzed: null });
      vi.mocked(prisma.ticker.delete).mockResolvedValue({} as any);

      await tickerService.remove("AAPL");
      expect(prisma.ticker.delete).toHaveBeenCalledWith({ where: { symbol: "AAPL" } });
    });

    it("throws NotFoundError for unknown symbol", async () => {
      vi.mocked(prisma.ticker.findUnique).mockResolvedValue(null);
      await expect(tickerService.remove("FAKE")).rejects.toThrow("not found");
    });
  });
});
