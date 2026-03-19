import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../helpers/mock-prisma.js";

vi.mock("../../db/index.js", () => ({
  prisma: createMockPrisma(),
}));

const mockProvider = {
  name: "mock",
  searchTickers: vi.fn(),
};

vi.mock("../../providers/index.js", () => ({
  getMarketDataProvider: vi.fn(),
}));

vi.mock("../../services/ticker.service.js", () => ({
  tickerService: {
    add: vi.fn(),
  },
}));

vi.mock("../../services/pipeline.service.js", () => ({
  pipelineService: {
    generateReport: vi.fn(),
  },
}));

import { prisma } from "../../db/index.js";
import { getMarketDataProvider } from "../../providers/index.js";
import { tickerService } from "../../services/ticker.service.js";
import { pipelineService } from "../../services/pipeline.service.js";
import { screenerService } from "../../services/screener.service.js";

describe("screenerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMarketDataProvider).mockReturnValue(mockProvider as any);
  });

  describe("runScreener", () => {
    it("throws NotFoundError for unknown config", async () => {
      vi.mocked(prisma.screenerConfig.findUnique).mockResolvedValue(null);

      await expect(screenerService.runScreener("bad-id")).rejects.toThrow(
        "ScreenerConfig 'bad-id' not found"
      );
    });

    it("searches, filters by minPrice, adds tickers, and queues reports", async () => {
      vi.mocked(prisma.screenerConfig.findUnique).mockResolvedValue({
        id: "cfg-1",
        name: "Growth stocks",
        criteria: { market: "stocks", minPrice: 5 },
        schedule: "0 9 * * 1-5",
        enabled: true,
        lastRun: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      // Provider returns 3 results, one is a penny stock (price < 5)
      mockProvider.searchTickers.mockResolvedValue([
        { symbol: "AAPL", name: "Apple", market: "stocks", type: "CS", active: true, marketCap: 3e12, lastPrice: 180 },
        { symbol: "PENNY", name: "Penny Co", market: "stocks", type: "CS", active: true, marketCap: 1e6, lastPrice: 0.5 },
        { symbol: "MSFT", name: "Microsoft", market: "stocks", type: "CS", active: true, marketCap: 2.8e12, lastPrice: 420 },
      ]);

      vi.mocked(tickerService.add).mockResolvedValue({
        added: [
          { symbol: "AAPL", id: "t1", status: "active", source: "screener", addedAt: new Date(), lastAnalyzed: null },
          { symbol: "MSFT", id: "t2", status: "active", source: "screener", addedAt: new Date(), lastAnalyzed: null },
        ],
        skipped: [],
      } as any);

      vi.mocked(pipelineService.generateReport).mockResolvedValue("job-1");
      vi.mocked(prisma.screenerConfig.update).mockResolvedValue({} as any);

      const result = await screenerService.runScreener("cfg-1");

      // PENNY filtered out by minPrice: 5
      expect(result.discovered).toEqual(["AAPL", "MSFT"]);
      expect(result.added).toEqual(["AAPL", "MSFT"]);
      expect(result.skipped).toEqual([]);
      expect(result.reportsQueued).toBe(2);

      // Verify provider was called with correct params
      expect(mockProvider.searchTickers).toHaveBeenCalledWith({
        market: "stocks",
        type: undefined,
        search: undefined,
        active: true,
        limit: 100,
      });

      // Verify tickerService.add was called with filtered symbols
      expect(tickerService.add).toHaveBeenCalledWith(
        ["AAPL", "MSFT"],
        "screener"
      );

      // Verify reports were queued
      expect(pipelineService.generateReport).toHaveBeenCalledTimes(2);
      expect(pipelineService.generateReport).toHaveBeenCalledWith("AAPL");
      expect(pipelineService.generateReport).toHaveBeenCalledWith("MSFT");

      // Verify lastRun timestamp was updated
      expect(prisma.screenerConfig.update).toHaveBeenCalledWith({
        where: { id: "cfg-1" },
        data: { lastRun: expect.any(Date) },
      });
    });

    it("null values fail post-filter constraints (null marketCap fails minMarketCap)", async () => {
      vi.mocked(prisma.screenerConfig.findUnique).mockResolvedValue({
        id: "cfg-2",
        name: "Large caps",
        criteria: { minMarketCap: 1e9 },
        schedule: "0 9 * * 1-5",
        enabled: true,
        lastRun: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      // Ticker with null marketCap should be filtered out
      mockProvider.searchTickers.mockResolvedValue([
        { symbol: "KNOWN", name: "Known Corp", market: "stocks", type: "CS", active: true, marketCap: 5e9, lastPrice: 100 },
        { symbol: "UNKNOWN", name: "Unknown Corp", market: "stocks", type: "CS", active: true, marketCap: null, lastPrice: 50 },
      ]);

      vi.mocked(tickerService.add).mockResolvedValue({
        added: [{ symbol: "KNOWN", id: "t1", status: "active", source: "screener", addedAt: new Date(), lastAnalyzed: null }],
        skipped: [],
      } as any);

      vi.mocked(pipelineService.generateReport).mockResolvedValue("job-1");
      vi.mocked(prisma.screenerConfig.update).mockResolvedValue({} as any);

      const result = await screenerService.runScreener("cfg-2");

      // UNKNOWN filtered out because null marketCap fails minMarketCap constraint
      expect(result.discovered).toEqual(["KNOWN"]);
      expect(tickerService.add).toHaveBeenCalledWith(["KNOWN"], "screener");
    });

    it("caps results at maxResults", async () => {
      vi.mocked(prisma.screenerConfig.findUnique).mockResolvedValue({
        id: "cfg-3",
        name: "Top 2",
        criteria: { maxResults: 2 },
        schedule: "0 9 * * 1-5",
        enabled: true,
        lastRun: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      // Provider returns 5 results
      mockProvider.searchTickers.mockResolvedValue([
        { symbol: "A", name: "A Corp", market: "stocks", type: "CS", active: true, marketCap: 1e9, lastPrice: 10 },
        { symbol: "B", name: "B Corp", market: "stocks", type: "CS", active: true, marketCap: 2e9, lastPrice: 20 },
        { symbol: "C", name: "C Corp", market: "stocks", type: "CS", active: true, marketCap: 3e9, lastPrice: 30 },
        { symbol: "D", name: "D Corp", market: "stocks", type: "CS", active: true, marketCap: 4e9, lastPrice: 40 },
        { symbol: "E", name: "E Corp", market: "stocks", type: "CS", active: true, marketCap: 5e9, lastPrice: 50 },
      ]);

      vi.mocked(tickerService.add).mockResolvedValue({
        added: [],
        skipped: ["A", "B"],
      } as any);

      vi.mocked(prisma.screenerConfig.update).mockResolvedValue({} as any);

      const result = await screenerService.runScreener("cfg-3");

      // Only first 2 results should be discovered (maxResults: 2)
      expect(result.discovered).toEqual(["A", "B"]);
      expect(tickerService.add).toHaveBeenCalledWith(["A", "B"], "screener");
    });
  });

  describe("createConfig", () => {
    it("stores config in DB", async () => {
      const configData = {
        name: "Tech Screener",
        criteria: { market: "stocks", type: "CS", minPrice: 10 },
        schedule: "0 9 * * 1-5",
      };

      const created = {
        id: "cfg-new",
        ...configData,
        enabled: true,
        lastRun: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.screenerConfig.create).mockResolvedValue(created as any);

      const result = await screenerService.createConfig(configData);

      expect(result).toEqual(created);
      expect(prisma.screenerConfig.create).toHaveBeenCalledWith({
        data: {
          name: "Tech Screener",
          criteria: { market: "stocks", type: "CS", minPrice: 10 },
          schedule: "0 9 * * 1-5",
          enabled: true,
        },
      });
    });
  });

  describe("getConfig", () => {
    it("throws NotFoundError for unknown id", async () => {
      vi.mocked(prisma.screenerConfig.findUnique).mockResolvedValue(null);

      await expect(screenerService.getConfig("bad-id")).rejects.toThrow(
        "ScreenerConfig 'bad-id' not found"
      );
    });
  });

  describe("deleteConfig", () => {
    it("throws NotFoundError for unknown id", async () => {
      vi.mocked(prisma.screenerConfig.findUnique).mockResolvedValue(null);

      await expect(screenerService.deleteConfig("bad-id")).rejects.toThrow(
        "ScreenerConfig 'bad-id' not found"
      );
    });
  });
});
