import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma - must be before service import
vi.mock("../../db/index.js", () => ({
  prisma: {
    tickerProfile: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    priceHistoryCache: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    researchReport: {
      findFirst: vi.fn(),
    },
    analysis: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock Polygon provider
vi.mock("../../services/research/providers/polygon.provider.js", () => ({
  PolygonProvider: class {
    async getTickerDetails() {
      return {
        name: "Apple Inc.",
        description: "Designs consumer electronics.",
        sector: null,
        industry: "Electronic Computers",
        type: "CS",
        marketCap: 3400000000000,
      };
    }
    async getHistoricalOHLCV() {
      return [
        { date: "2023-01-03", open: 130, high: 131, low: 129, close: 130.5, volume: 1000000 },
        { date: "2023-01-04", open: 131, high: 132, low: 130, close: 131.5, volume: 1100000 },
      ];
    }
  },
}));

import { tickerProfileService } from "../../services/tickerProfile.service.js";

describe("TickerProfileService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a profile response with chart and no research report", async () => {
    const { prisma } = await import("../../db/index.js");

    (prisma.tickerProfile.findUnique as any).mockResolvedValue(null);
    (prisma.priceHistoryCache.findUnique as any).mockResolvedValue(null);
    (prisma.researchReport.findFirst as any).mockResolvedValue(null);
    (prisma.analysis.findFirst as any).mockResolvedValue(null);
    (prisma.tickerProfile.upsert as any).mockResolvedValue({});
    (prisma.priceHistoryCache.upsert as any).mockResolvedValue({});

    const result = await tickerProfileService.getProfile("AAPL");

    expect(result.symbol).toBe("AAPL");
    expect(result.companyName).toBe("Apple Inc.");
    expect(result.chart).toHaveLength(2);
    expect(result.recommendation).toBeNull();
  });
});
