import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/index.js", () => ({
  prisma: {
    ivHistoryCache: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("../../services/ibkr.js", () => ({
  ibkrService: { isConnected: vi.fn(() => true) },
}));

vi.mock("../../services/historicalData.js", () => ({
  historicalDataService: { getImpliedVolatilityHistory: vi.fn() },
}));

import { prisma } from "../../db/index.js";
import { ibkrService } from "../../services/ibkr.js";
import { historicalDataService } from "../../services/historicalData.js";
import { ivRankService } from "../../services/ivRank.service.js";

const mockPrisma = vi.mocked(prisma, true);
const mockIbkr = vi.mocked(ibkrService);
const mockHist = vi.mocked(historicalDataService);

/**
 * `count` IV points ramping linearly from `from` to `to`.
 * This is the *cached* shape (`{ date, iv }`) — what the service stores and
 * what `computeFromSeries` consumes.
 */
function series(count: number, from: number, to: number) {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    iv: count === 1 ? from : from + ((to - from) * i) / (count - 1),
  }));
}

/**
 * The same points in the *TWS bar* shape (`{ date, close }`) that
 * `getImpliedVolatilityHistory` returns. The two shapes are deliberately
 * distinct: the service maps close → iv through `normalizeIv`, and a test that
 * blurred them would not catch a broken mapping.
 */
function asBars(points: { date: string; iv: number }[]) {
  return points.map((p) => ({ date: p.date, close: p.iv }));
}

describe("ivRankService.getIvRank", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIbkr.isConnected.mockReturnValue(true);
    mockPrisma.ivHistoryCache.findUnique.mockResolvedValue(null);
    mockPrisma.ivHistoryCache.upsert.mockResolvedValue({} as never);
  });

  it("ranks the last bar within the window", async () => {
    // 252 bars ramping 0.10 → 0.50; last bar is the max.
    mockHist.getImpliedVolatilityHistory.mockResolvedValue(asBars(series(252, 0.1, 0.5)));

    const result = await ivRankService.getIvRank("AAPL");

    expect(result.reason).toBeNull();
    expect(result.info?.ivRank).toBeCloseTo(100, 5);
    expect(result.info?.currentIv).toBeCloseTo(0.5, 5);
    expect(result.info?.iv52wLow).toBeCloseTo(0.1, 5);
    expect(result.info?.iv52wHigh).toBeCloseTo(0.5, 5);
    expect(result.info?.windowDays).toBe(252);
  });

  it("ranks 0 when the last bar is the window low", async () => {
    mockHist.getImpliedVolatilityHistory.mockResolvedValue(asBars(series(252, 0.5, 0.1)));

    const result = await ivRankService.getIvRank("AAPL");

    expect(result.info?.ivRank).toBeCloseTo(0, 5);
  });

  it("ranks at the midpoint when current IV sits halfway", async () => {
    const bars = asBars([
      ...series(251, 0.2, 0.4),
      { date: "2026-02-01", iv: 0.3 },
    ]);
    mockHist.getImpliedVolatilityHistory.mockResolvedValue(bars);

    const result = await ivRankService.getIvRank("AAPL");

    expect(result.info?.ivRank).toBeCloseTo(50, 5);
  });

  it("trims to the most recent 252 bars, ignoring older extremes", async () => {
    // A 0.99 spike 300 days ago must not become the 52-week high.
    const bars = asBars([
      { date: "2025-01-01", iv: 0.99 },
      ...series(300, 0.2, 0.4),
    ]);
    mockHist.getImpliedVolatilityHistory.mockResolvedValue(bars);

    const result = await ivRankService.getIvRank("AAPL");

    expect(result.info?.windowDays).toBe(252);
    expect(result.info?.iv52wHigh).toBeLessThan(0.5);
  });

  it("drops bars with missing or non-positive closes", async () => {
    const bars = asBars([
      ...series(252, 0.2, 0.4),
      { date: "2026-02-02", iv: 0 },
      { date: "2026-02-03", iv: -1 },
    ]);
    mockHist.getImpliedVolatilityHistory.mockResolvedValue(bars);

    const result = await ivRankService.getIvRank("AAPL");

    expect(result.info?.currentIv).toBeCloseTo(0.4, 5);
  });

  it("reports tws_disconnected without calling TWS", async () => {
    mockIbkr.isConnected.mockReturnValue(false);

    const result = await ivRankService.getIvRank("AAPL");

    expect(result.info).toBeNull();
    expect(result.reason).toBe("tws_disconnected");
    expect(mockHist.getImpliedVolatilityHistory).not.toHaveBeenCalled();
  });

  it("reports no_iv_data for an empty series", async () => {
    mockHist.getImpliedVolatilityHistory.mockResolvedValue([]);

    const result = await ivRankService.getIvRank("AAPL");

    expect(result.info).toBeNull();
    expect(result.reason).toBe("no_iv_data");
  });

  it("reports insufficient_history at 125 bars", async () => {
    mockHist.getImpliedVolatilityHistory.mockResolvedValue(asBars(series(125, 0.2, 0.4)));

    const result = await ivRankService.getIvRank("AAPL");

    expect(result.info).toBeNull();
    expect(result.reason).toBe("insufficient_history");
  });

  it("succeeds at exactly 126 bars and records the partial window", async () => {
    mockHist.getImpliedVolatilityHistory.mockResolvedValue(asBars(series(126, 0.2, 0.4)));

    const result = await ivRankService.getIvRank("AAPL");

    expect(result.reason).toBeNull();
    expect(result.info?.windowDays).toBe(126);
  });

  it("reports degenerate_range for a flat series", async () => {
    mockHist.getImpliedVolatilityHistory.mockResolvedValue(asBars(series(252, 0.3, 0.3)));

    const result = await ivRankService.getIvRank("AAPL");

    expect(result.info).toBeNull();
    expect(result.reason).toBe("degenerate_range");
  });

  it("never substitutes a neutral 50 on any failure path", async () => {
    mockHist.getImpliedVolatilityHistory.mockResolvedValue([]);
    const empty = await ivRankService.getIvRank("AAPL");
    mockHist.getImpliedVolatilityHistory.mockResolvedValue(asBars(series(252, 0.3, 0.3)));
    const flat = await ivRankService.getIvRank("MSFT");

    expect(empty.info).toBeNull();
    expect(flat.info).toBeNull();
  });
});

describe("ivRankService cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIbkr.isConnected.mockReturnValue(true);
    mockPrisma.ivHistoryCache.upsert.mockResolvedValue({} as never);
  });

  it("serves a fresh cached series without hitting TWS", async () => {
    mockPrisma.ivHistoryCache.findUnique.mockResolvedValue({
      symbol: "AAPL",
      data: series(252, 0.1, 0.5),
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    const result = await ivRankService.getIvRank("AAPL");

    expect(result.info?.ivRank).toBeCloseTo(100, 5);
    expect(mockHist.getImpliedVolatilityHistory).not.toHaveBeenCalled();
  });

  it("refetches when the cached series has expired", async () => {
    mockPrisma.ivHistoryCache.findUnique.mockResolvedValue({
      symbol: "AAPL",
      data: series(252, 0.1, 0.5),
      fetchedAt: new Date(Date.now() - 90_000_000),
      expiresAt: new Date(Date.now() - 1000),
    } as never);
    mockHist.getImpliedVolatilityHistory.mockResolvedValue(asBars(series(252, 0.2, 0.4)));

    await ivRankService.getIvRank("AAPL");

    expect(mockHist.getImpliedVolatilityHistory).toHaveBeenCalledTimes(1);
  });

  it("writes the fetched series to the cache", async () => {
    mockPrisma.ivHistoryCache.findUnique.mockResolvedValue(null);
    mockHist.getImpliedVolatilityHistory.mockResolvedValue(asBars(series(252, 0.2, 0.4)));

    await ivRankService.getIvRank("AAPL");

    expect(mockPrisma.ivHistoryCache.upsert).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.ivHistoryCache.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ symbol: "AAPL" });
  });

  it("uppercases the symbol before lookup", async () => {
    mockPrisma.ivHistoryCache.findUnique.mockResolvedValue(null);
    mockHist.getImpliedVolatilityHistory.mockResolvedValue([]);

    await ivRankService.getIvRank("aapl");

    expect(mockPrisma.ivHistoryCache.findUnique).toHaveBeenCalledWith({
      where: { symbol: "AAPL" },
    });
  });
});
