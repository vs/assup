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
    it("creates new tickers via batch", async () => {
      // No existing tickers
      vi.mocked(prisma.ticker.findMany).mockResolvedValue([]);
      vi.mocked(prisma.ticker.createManyAndReturn).mockResolvedValue([
        { id: "1", symbol: "AAPL", source: "manual", status: "active", addedAt: new Date(), lastAnalyzed: null },
        { id: "2", symbol: "GOOG", source: "manual", status: "active", addedAt: new Date(), lastAnalyzed: null },
      ]);

      const result = await tickerService.add(["AAPL", "GOOG"], "manual");
      expect(result.added).toHaveLength(2);
      expect(result.skipped).toHaveLength(0);
      expect(prisma.ticker.createManyAndReturn).toHaveBeenCalledWith({
        data: [{ symbol: "AAPL", source: "manual" }, { symbol: "GOOG", source: "manual" }],
        skipDuplicates: true,
      });
      expect(prisma.ticker.findUnique).not.toHaveBeenCalled();
    });

    it("skips already-existing active tickers", async () => {
      vi.mocked(prisma.ticker.findMany).mockResolvedValue([
        { id: "1", symbol: "AAPL", status: "active", source: "manual", addedAt: new Date(), lastAnalyzed: null },
      ]);

      const result = await tickerService.add(["AAPL"], "manual");
      expect(result.added).toHaveLength(0);
      expect(result.skipped).toEqual(["AAPL"]);
      expect(prisma.ticker.createManyAndReturn).not.toHaveBeenCalled();
      expect(prisma.ticker.updateMany).not.toHaveBeenCalled();
      expect(prisma.ticker.findUnique).not.toHaveBeenCalled();
    });

    it("reactivates removed tickers via batch", async () => {
      // Initial findMany returns the removed ticker
      vi.mocked(prisma.ticker.findMany)
        .mockResolvedValueOnce([
          { id: "1", symbol: "AAPL", status: "removed", source: "manual", addedAt: new Date(), lastAnalyzed: null },
        ])
        // Second findMany (after updateMany) returns the reactivated ticker
        .mockResolvedValueOnce([
          { id: "1", symbol: "AAPL", status: "active", source: "external", addedAt: new Date(), lastAnalyzed: null },
        ]);
      vi.mocked(prisma.ticker.updateMany).mockResolvedValue({ count: 1 });

      const result = await tickerService.add(["AAPL"], "external");
      expect(result.added).toHaveLength(1);
      expect(prisma.ticker.updateMany).toHaveBeenCalledWith({
        where: { symbol: { in: ["AAPL"] } },
        data: { status: "active", source: "external" },
      });
      expect(prisma.ticker.findUnique).not.toHaveBeenCalled();
    });

    it("handles mixed: new, removed, and active tickers in one batch", async () => {
      // Initial findMany returns existing tickers
      vi.mocked(prisma.ticker.findMany)
        .mockResolvedValueOnce([
          { id: "1", symbol: "AAPL", status: "active", source: "manual", addedAt: new Date(), lastAnalyzed: null },
          { id: "2", symbol: "MSFT", status: "removed", source: "manual", addedAt: new Date(), lastAnalyzed: null },
        ])
        // Second findMany (reactivated tickers)
        .mockResolvedValueOnce([
          { id: "2", symbol: "MSFT", status: "active", source: "screener", addedAt: new Date(), lastAnalyzed: null },
        ]);
      vi.mocked(prisma.ticker.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.ticker.createManyAndReturn).mockResolvedValue([
        { id: "3", symbol: "GOOG", source: "screener", status: "active", addedAt: new Date(), lastAnalyzed: null },
      ]);

      const result = await tickerService.add(["AAPL", "MSFT", "GOOG"], "screener");
      expect(result.added).toHaveLength(2); // MSFT reactivated + GOOG created
      expect(result.skipped).toEqual(["AAPL"]);
      expect(prisma.ticker.updateMany).toHaveBeenCalled();
      expect(prisma.ticker.createManyAndReturn).toHaveBeenCalledWith({
        data: [{ symbol: "GOOG", source: "screener" }],
        skipDuplicates: true,
      });
      expect(prisma.ticker.findUnique).not.toHaveBeenCalled();
    });

    it("uses skipDuplicates to handle concurrent adds (TOCTOU race)", async () => {
      // No existing tickers found
      vi.mocked(prisma.ticker.findMany).mockResolvedValue([]);
      // createManyAndReturn with skipDuplicates silently skips the duplicate
      vi.mocked(prisma.ticker.createManyAndReturn).mockResolvedValue([]);

      const result = await tickerService.add(["AAPL"], "manual");
      expect(result.added).toHaveLength(0);
      expect(prisma.ticker.createManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true })
      );
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
