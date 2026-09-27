import { describe, it, expect, vi, beforeEach } from "vitest";

const polygonCalls = vi.hoisted(() => ({ tickerDetails: [] as string[] }));

vi.mock("../../db/index.js", () => ({
  prisma: {
    tickerProfile: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    priceHistoryCache: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    researchReport: { findFirst: vi.fn(), findMany: vi.fn() },
    analysis: { findFirst: vi.fn() },
  },
}));

vi.mock("../../services/ivRank.service.js", () => ({
  ivRankService: { getIvRank: vi.fn(), getIvRankCachedOnly: vi.fn() },
}));

vi.mock("../../services/research/providers/polygon.provider.js", () => ({
  PolygonProvider: class {
    constructor(private opts: { priority?: string } = {}) {}
    async getTickerDetails(symbol: string) {
      polygonCalls.tickerDetails.push(`${this.opts.priority ?? "interactive"}:${symbol}`);
      return {
        name: symbol, description: "", sector: null, industry: null,
        type: null, marketCap: null, sharesOutstanding: null,
      };
    }
    async getPreviousClose() { return 100; }
  },
}));

vi.mock("../../services/historicalData.js", () => ({
  historicalDataService: { getLongTermData: vi.fn() },
}));

import { tickerProfileService } from "../../services/tickerProfile.service.js";
import { historicalDataService } from "../../services/historicalData.js";
import { ivRankService } from "../../services/ivRank.service.js";
import { prisma } from "../../db/index.js";

const SYMBOLS = Array.from({ length: 30 }, (_, i) => `SYM${i}`);
const STALE = new Date(Date.now() - 60_000);

/** Let the unawaited background refreshes run. */
const settleBackgroundWork = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  vi.clearAllMocks();
  polygonCalls.tickerDetails.length = 0;

  (historicalDataService.getLongTermData as any).mockResolvedValue([
    { date: "2026-01-05", close: 100 },
    { date: "2026-01-12", close: 101 },
  ]);
  (ivRankService.getIvRank as any).mockResolvedValue({ info: null, reason: "no_iv_data" });
  (ivRankService.getIvRankCachedOnly as any).mockResolvedValue({ info: null, reason: "no_iv_data" });

  // Every row is cached but stale — the stale-while-revalidate path
  (prisma.tickerProfile.findMany as any).mockResolvedValue(
    SYMBOLS.map((symbol) => ({ symbol, companyName: symbol, expiresAt: STALE })),
  );
  (prisma.priceHistoryCache.findMany as any).mockResolvedValue(
    SYMBOLS.map((symbol) => ({ symbol, data: [], expiresAt: STALE })),
  );
  (prisma.researchReport.findMany as any).mockResolvedValue([]);
  (prisma.researchReport.findFirst as any).mockResolvedValue(null);
  (prisma.analysis.findFirst as any).mockResolvedValue(null);
  (prisma.tickerProfile.upsert as any).mockResolvedValue({});
  (prisma.priceHistoryCache.upsert as any).mockResolvedValue({});
});

describe("stale-while-revalidate fan-out", () => {
  it("caps how many stale rows one batch refreshes in the background", async () => {
    await tickerProfileService.getBatchProfiles(SYMBOLS);
    await settleBackgroundWork();

    expect(polygonCalls.tickerDetails.length).toBeLessThanOrEqual(5);
  });

  it("runs background refreshes on the background lane", async () => {
    await tickerProfileService.getBatchProfiles(SYMBOLS);
    await settleBackgroundWork();

    expect(polygonCalls.tickerDetails.length).toBeGreaterThan(0);
    expect(polygonCalls.tickerDetails.every((c) => c.startsWith("background:"))).toBe(true);
  });
});
