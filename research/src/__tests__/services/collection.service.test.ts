import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrisma } from "../helpers/mock-prisma.js";

vi.mock("../../db/index.js", () => ({
  prisma: createMockPrisma(),
}));

vi.mock("../../collectors/registry.js", () => ({
  getCollector: vi.fn(),
  getAllCollectors: vi.fn(),
}));

vi.mock("../../analyzers/registry.js", () => ({
  getAnalyzer: vi.fn(),
}));

import { prisma } from "../../db/index.js";
import { getCollector, getAllCollectors } from "../../collectors/registry.js";
import { getAnalyzer } from "../../analyzers/registry.js";
import { collectionService } from "../../services/collection.service.js";

describe("collectionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("collectSource", () => {
    it("throws for unknown collector", async () => {
      vi.mocked(getCollector).mockReturnValue(undefined);

      await expect(
        collectionService.collectSource("t1", "AAPL", "unknown_source")
      ).rejects.toThrow("Unknown collector: unknown_source");
    });

    it("skips collection when data is still fresh (not expired)", async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      vi.mocked(getCollector).mockReturnValue({
        source: "technical",
        defaultSchedule: "0 * * * *",
        stalenessMinutes: 60,
        collect: vi.fn(),
      });
      vi.mocked(prisma.dataCollection.findFirst).mockResolvedValue({
        id: "dc-1",
        tickerId: "t1",
        source: "technical",
        data: {},
        expiresAt: futureDate,
        collectedAt: new Date(),
      } as any);

      const result = await collectionService.collectSource("t1", "AAPL", "technical");
      expect(result).toBe(false);
      expect(prisma.dataCollection.create).not.toHaveBeenCalled();
    });

    it("collects fresh data when existing is expired", async () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const mockCollector = {
        source: "technical",
        defaultSchedule: "0 * * * *",
        stalenessMinutes: 60,
        collect: vi.fn().mockResolvedValue({
          source: "technical",
          data: { price: 150 },
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
      };
      vi.mocked(getCollector).mockReturnValue(mockCollector);
      vi.mocked(prisma.dataCollection.findFirst).mockResolvedValue({
        id: "dc-1",
        tickerId: "t1",
        source: "technical",
        data: {},
        expiresAt: pastDate,
        collectedAt: new Date(),
      } as any);
      vi.mocked(prisma.dataCollection.create).mockResolvedValue({} as any);

      const result = await collectionService.collectSource("t1", "AAPL", "technical");
      expect(result).toBe(true);
      expect(mockCollector.collect).toHaveBeenCalledWith("AAPL");
      expect(prisma.dataCollection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tickerId: "t1",
            source: "technical",
          }),
        })
      );
    });

    it("forces collection when force=true (skips freshness check)", async () => {
      const mockCollector = {
        source: "technical",
        defaultSchedule: "0 * * * *",
        stalenessMinutes: 60,
        collect: vi.fn().mockResolvedValue({
          source: "technical",
          data: { price: 150 },
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
      };
      vi.mocked(getCollector).mockReturnValue(mockCollector);
      vi.mocked(prisma.dataCollection.create).mockResolvedValue({} as any);

      const result = await collectionService.collectSource("t1", "AAPL", "technical", true);
      expect(result).toBe(true);
      expect(prisma.dataCollection.findFirst).not.toHaveBeenCalled();
      expect(mockCollector.collect).toHaveBeenCalledWith("AAPL");
    });

    it("writes skipped row when collector returns SkippedCollection", async () => {
      const mockCollector = {
        source: "options",
        defaultSchedule: "0 18 * * 1-5",
        stalenessMinutes: 1440,
        collect: vi.fn().mockResolvedValue({
          _tag: "skipped",
          source: "options",
          reason: "Polygon options API not authorized (403)",
          expiresAt: new Date(Date.now() + 1440 * 60 * 1000),
        }),
      };
      vi.mocked(getCollector).mockReturnValue(mockCollector);
      vi.mocked(prisma.dataCollection.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.dataCollection.create).mockResolvedValue({} as any);

      const result = await collectionService.collectSource("t1", "AAPL", "options");
      expect(result).toBe(true);
      expect(prisma.dataCollection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tickerId: "t1",
          source: "options",
          status: "skipped",
          skipReason: "Polygon options API not authorized (403)",
        }),
      });
    });
  });

  describe("analyzeSource", () => {
    it("returns null when no analyzer exists", async () => {
      vi.mocked(getAnalyzer).mockReturnValue(undefined);

      const result = await collectionService.analyzeSource("t1", "unknown_source");
      expect(result).toBeNull();
    });

    it("returns null when no collected data exists", async () => {
      vi.mocked(getAnalyzer).mockReturnValue({
        source: "technical",
        analyze: vi.fn(),
      });
      vi.mocked(prisma.dataCollection.findFirst).mockResolvedValue(null);

      const result = await collectionService.analyzeSource("t1", "technical");
      expect(result).toBeNull();
    });

    it("filters by status ok when finding latest data", async () => {
      vi.mocked(getAnalyzer).mockReturnValue({
        source: "options",
        analyze: vi.fn(),
      });
      vi.mocked(prisma.dataCollection.findFirst).mockResolvedValue(null);

      await collectionService.analyzeSource("t1", "options");
      expect(prisma.dataCollection.findFirst).toHaveBeenCalledWith({
        where: { tickerId: "t1", source: "options", status: "ok" },
        orderBy: { collectedAt: "desc" },
      });
    });

    it("analyzes data and stores result, returns analysis ID", async () => {
      const mockAnalyzer = {
        source: "technical",
        analyze: vi.fn().mockResolvedValue({
          signal: "bullish",
          confidence: 0.8,
          summary: "Looks good",
          details: { rsi: 65 },
        }),
      };
      vi.mocked(getAnalyzer).mockReturnValue(mockAnalyzer);
      vi.mocked(prisma.dataCollection.findFirst).mockResolvedValue({
        id: "dc-1",
        tickerId: "t1",
        source: "technical",
        data: { price: 150 },
        expiresAt: new Date(),
        collectedAt: new Date(),
      } as any);
      vi.mocked(prisma.analysis.create).mockResolvedValue({
        id: "analysis-1",
        tickerId: "t1",
        source: "technical",
        signal: "bullish",
        confidence: 0.8,
        summary: "Looks good",
        details: { rsi: 65 },
        analyzedAt: new Date(),
      } as any);

      const result = await collectionService.analyzeSource("t1", "technical");
      expect(result).toBe("analysis-1");
      expect(mockAnalyzer.analyze).toHaveBeenCalledWith({ price: 150 });
      expect(prisma.analysis.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tickerId: "t1",
            source: "technical",
            signal: "bullish",
            confidence: 0.8,
            summary: "Looks good",
          }),
        })
      );
    });
  });

  describe("collectAndAnalyzeAll", () => {
    it("updates ticker lastAnalyzed timestamp", async () => {
      // Provide sources explicitly to avoid collector/analyzer complexity
      vi.mocked(getAllCollectors).mockReturnValue([]);
      // Mock getCollector to return a valid collector for "src1"
      vi.mocked(getCollector).mockReturnValue({
        source: "src1",
        defaultSchedule: "0 * * * *",
        stalenessMinutes: 60,
        collect: vi.fn().mockResolvedValue({
          source: "src1",
          data: { foo: 1 },
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
      });
      vi.mocked(prisma.dataCollection.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.dataCollection.create).mockResolvedValue({} as any);
      // No analyzer for the source
      vi.mocked(getAnalyzer).mockReturnValue(undefined);
      vi.mocked(prisma.ticker.update).mockResolvedValue({} as any);

      await collectionService.collectAndAnalyzeAll("t1", "AAPL", {
        sources: ["src1"],
      });

      expect(prisma.ticker.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "t1" },
          data: expect.objectContaining({ lastAnalyzed: expect.any(Date) }),
        })
      );
    });
  });
});
