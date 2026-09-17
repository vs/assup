import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma - must be before service import
vi.mock("../../db/index.js", () => ({
  prisma: {
    tickerProfile: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    priceHistoryCache: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    researchReport: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    analysis: {
      findFirst: vi.fn(),
    },
    ivHistoryCache: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("../../services/ivRank.service.js", () => ({
  ivRankService: {
    getIvRank: vi.fn(),
    getIvRankCachedOnly: vi.fn(),
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
  },
}));

// Mock historical data service (TWS)
vi.mock("../../services/historicalData.js", () => ({
  historicalDataService: {
    getLongTermData: vi.fn(),
  },
}));

import { tickerProfileService } from "../../services/tickerProfile.service.js";
import { historicalDataService } from "../../services/historicalData.js";
import { ivRankService } from "../../services/ivRank.service.js";

const mockIvRank = vi.mocked(ivRankService);

describe("TickerProfileService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (historicalDataService.getLongTermData as any).mockResolvedValue([
      { date: "2023-01-06", close: 130.5 },
      { date: "2023-01-13", close: 131.5 },
    ]);
    mockIvRank.getIvRank.mockResolvedValue({ info: null, reason: "no_iv_data" });
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

const IV_INFO = {
  ivRank: 82,
  currentIv: 0.341,
  iv52wLow: 0.182,
  iv52wHigh: 0.395,
  windowDays: 252,
  asOf: "2026-08-10",
};

describe("tickerProfileService IV Rank", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (historicalDataService.getLongTermData as any).mockResolvedValue([
      { date: "2023-01-06", close: 130.5 },
      { date: "2023-01-13", close: 131.5 },
    ]);
  });

  it("includes IV Rank on a single-symbol profile", async () => {
    mockIvRank.getIvRank.mockResolvedValue({ info: IV_INFO, reason: null });

    const profile = await tickerProfileService.getProfile("AAPL");

    expect(profile.ivRank).toEqual(IV_INFO);
    expect(profile.ivRankUnavailableReason).toBeNull();
  });

  it("surfaces the unavailability reason instead of a value", async () => {
    mockIvRank.getIvRank.mockResolvedValue({
      info: null,
      reason: "tws_disconnected",
    });

    const profile = await tickerProfileService.getProfile("AAPL");

    expect(profile.ivRank).toBeNull();
    expect(profile.ivRankUnavailableReason).toBe("tws_disconnected");
  });

  it("does not fail the whole profile when IV Rank throws", async () => {
    mockIvRank.getIvRank.mockRejectedValue(new Error("TWS timeout"));

    const profile = await tickerProfileService.getProfile("AAPL");

    // Company info and chart must still be served.
    expect(profile.symbol).toBe("AAPL");
    expect(profile.ivRank).toBeNull();
    expect(profile.ivRankUnavailableReason).toBe("no_iv_data");
  });

  it("never issues a TWS-backed IV fetch from the batch path", async () => {
    const { prisma } = await import("../../db/index.js");
    const farFuture = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const symbols = ["AAPL", "MSFT", "NVDA"];
    (prisma.tickerProfile.findMany as any).mockResolvedValue(
      symbols.map((symbol) => ({ symbol, expiresAt: farFuture }))
    );
    (prisma.priceHistoryCache.findMany as any).mockResolvedValue(
      symbols.map((symbol) => ({ symbol, data: [], expiresAt: farFuture }))
    );
    (prisma.researchReport.findMany as any).mockResolvedValue([]);

    mockIvRank.getIvRankCachedOnly.mockResolvedValue({
      info: null,
      reason: "no_iv_data",
      stale: false,
    });

    await tickerProfileService.getBatchProfiles(symbols);

    expect(mockIvRank.getIvRank).not.toHaveBeenCalled();
    expect(mockIvRank.getIvRankCachedOnly).toHaveBeenCalledTimes(3);
  });
});
