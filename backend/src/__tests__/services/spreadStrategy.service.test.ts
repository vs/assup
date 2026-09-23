import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/index.js", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("../../services/ibkr.js", () => ({
  ibkrService: {
    getHistoricalData: vi.fn(),
    isConnected: vi.fn(() => true),
  },
}));

const quoteGet = vi.fn();
vi.mock("../../services/quotes/index.js", async () => {
  const keys = await vi.importActual<typeof import("../../services/quotes/quoteKey.js")>("../../services/quotes/quoteKey.js");
  return { quoteHub: { get: (...args: unknown[]) => quoteGet(...args) }, quoteKey: keys.quoteKey };
});

vi.mock("../../services/research/providers/yahoo.js", () => ({
  fetchVix3m: vi.fn(),
}));

vi.mock("../../utils/market.js", () => ({
  isMarketOpen: vi.fn(() => false),
}));

import { spreadStrategyService } from "../../services/spreadStrategy.service.js";
import { ibkrService } from "../../services/ibkr.js";
import { fetchVix3m } from "../../services/research/providers/yahoo.js";
import { prisma } from "../../db/index.js";

const SPX_PRICE = 5200;
const VIX = 16.0;

function makeHistoricalBars() {
  // Twenty days of slow drift — enough for a 10-day realized vol calc.
  const bars = [];
  let price = 5100;
  for (let i = 0; i < 20; i++) {
    price *= 1 + (i % 2 === 0 ? 0.001 : -0.0008);
    bars.push({ close: price });
  }
  return bars;
}

beforeEach(() => {
  vi.clearAllMocks();
  const prices: Record<string, number> = { SPX: SPX_PRICE, VIX, RUT: 2000, RVX: 22 };
  quoteGet.mockImplementation(async (contracts: Array<{ symbol: string; secType: string }>) => {
    const { quoteKey } = await import("../../services/quotes/quoteKey.js");
    return new Map(contracts.map((c) => {
      const key = quoteKey(c);
      const price = prices[c.symbol];
      return [key, price != null
        ? { key, status: "ok", last: price, close: price, updatedAt: 1 }
        : { key, status: "timeout", updatedAt: null }];
    }));
  });
  (ibkrService.getHistoricalData as any).mockResolvedValue(makeHistoricalBars());
  (prisma.setting.findUnique as any).mockResolvedValue(null);
  (prisma.setting.upsert as any).mockResolvedValue({});
});

describe("SpreadStrategyService.getMetrics (SPX)", () => {
  it("returns live VIX3M from Yahoo and persists the snapshot", async () => {
    (fetchVix3m as any).mockResolvedValue(16.82);

    const metrics = await spreadStrategyService.getMetrics("SPX");

    expect(metrics.vix3m).toBe(16.82);
    expect(metrics.vix3mSource).toBe("live");
    expect(metrics.vix3mAgeMinutes).toBe(0);

    expect(prisma.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "vix3mSnapshot" },
        create: expect.objectContaining({
          key: "vix3mSnapshot",
          value: expect.objectContaining({ value: 16.82 }),
        }),
      }),
    );
  });

  it("falls back to the cached snapshot when Yahoo fails", async () => {
    (fetchVix3m as any).mockResolvedValue(null);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    (prisma.setting.findUnique as any).mockResolvedValue({
      key: "vix3mSnapshot",
      value: { value: 16.5, fetchedAt: twoHoursAgo },
    });

    const metrics = await spreadStrategyService.getMetrics("SPX");

    expect(metrics.vix3m).toBe(16.5);
    expect(metrics.vix3mSource).toBe("cached");
    expect(metrics.vix3mAgeMinutes).toBeGreaterThanOrEqual(119);
    expect(metrics.vix3mAgeMinutes).toBeLessThanOrEqual(121);
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it("returns source: none when both Yahoo and the cache are empty", async () => {
    (fetchVix3m as any).mockResolvedValue(null);
    (prisma.setting.findUnique as any).mockResolvedValue(null);

    const metrics = await spreadStrategyService.getMetrics("SPX");

    expect(metrics.vix3m).toBeNull();
    expect(metrics.vix3mSource).toBe("none");
    expect(metrics.vix3mAgeMinutes).toBeNull();

    const termFilter = metrics.filters.find((f) => f.name === "VIX Term Structure");
    expect(termFilter?.passed).toBe(false);
    expect(termFilter?.reason).toMatch(/Cannot compute/i);
  });

  it("does not fetch VIX3M from IBKR for SPX", async () => {
    (fetchVix3m as any).mockResolvedValue(16.82);
    await spreadStrategyService.getMetrics("SPX");

    const callArgs = quoteGet.mock.calls.map(
      (c: any[]) => c[0]?.[0]?.symbol,
    );
    expect(callArgs).not.toContain("VIX3M");
  });
});

describe("SpreadStrategyService.getMetrics (RUT)", () => {
  it("does not call fetchVix3m and uses spotVix as the VIX3M fallback", async () => {
    await spreadStrategyService.getMetrics("RUT");

    expect(fetchVix3m).not.toHaveBeenCalled();
  });
});
