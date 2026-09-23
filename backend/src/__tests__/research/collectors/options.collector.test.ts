import { describe, it, expect, vi, beforeEach } from "vitest";
import { optionsCollector } from "../../../services/research/collectors/options.collector.js";
import type { SkippedCollection } from "../../../services/research/collectors/types.js";

vi.mock("../../../services/ibkr.js", () => ({
  ibkrService: {
    isConnected: vi.fn(),
  },
}));

vi.mock("../../../services/research/providers/ibkr.provider.js", () => ({
  createIBKRProvider: vi.fn(),
}));

vi.mock("../../../utils/market.js", () => ({
  isMarketOpen: vi.fn(() => false),
}));

vi.mock("../../../services/ivRank.service.js", () => ({
  ivRankService: { getIvRank: vi.fn() },
}));

import { ibkrService } from "../../../services/ibkr.js";
import { createIBKRProvider } from "../../../services/research/providers/ibkr.provider.js";
import { ivRankService } from "../../../services/ivRank.service.js";

const mockIbkrService = vi.mocked(ibkrService);
const mockCreateIBKRProvider = vi.mocked(createIBKRProvider);
const mockIvRankService = vi.mocked(ivRankService);

describe("optionsCollector", () => {
  const mockProvider = {
    name: "ibkr",
    getOptionsChain: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockIbkrService.isConnected.mockReturnValue(true);
    mockCreateIBKRProvider.mockReturnValue(mockProvider as any);
    mockIvRankService.getIvRank.mockResolvedValue({ info: null, reason: "no_iv_data" });
  });

  it("has correct source and schedule", () => {
    expect(optionsCollector.source).toBe("options");
    expect(optionsCollector.stalenessMinutes).toBe(1440);
  });

  it("collects options chain via IBKR and returns data", async () => {
    const chain = [{ symbol: "AAPL", expiration: "2026-03-20", strike: 150, right: "C" as const, bid: 5, ask: 5.1, last: 5.05, volume: 100, openInterest: 0, impliedVolatility: 0.3, delta: 0.5, gamma: null, theta: null }];
    mockProvider.getOptionsChain.mockResolvedValue(chain);

    const result = await optionsCollector.collect("AAPL");
    expect(result).not.toHaveProperty("_tag");
    expect(result.source).toBe("options");
    expect((result as any).data.chain).toEqual(chain);
    expect((result as any).data.symbol).toBe("AAPL");
  });

  it("skips when TWS is not connected", async () => {
    mockIbkrService.isConnected.mockReturnValue(false);
    const result = await optionsCollector.collect("AAPL");
    expect(result).toMatchObject({
      _tag: "skipped",
      source: "options",
    });
    expect((result as SkippedCollection).reason).toContain("TWS not connected");
  });

  it("skips when no chain data returned", async () => {
    mockProvider.getOptionsChain.mockResolvedValue([]);
    const result = await optionsCollector.collect("AAPL");
    expect(result).toMatchObject({
      _tag: "skipped",
      source: "options",
    });
    expect((result as SkippedCollection).reason).toContain("No options chain");
  });

  it("requests 4 expirations", async () => {
    mockProvider.getOptionsChain.mockResolvedValue([
      { symbol: "AAPL", expiration: "2026-03-20", strike: 150, right: "C" as const, bid: 5, ask: 5.1, last: 5.05, volume: 100, openInterest: 0, impliedVolatility: 0.3, delta: 0.5, gamma: null, theta: null },
    ]);
    await optionsCollector.collect("AAPL");
    expect(mockProvider.getOptionsChain).toHaveBeenCalledWith("AAPL", 4);
  });

  it("propagates getOptionsChain failures", async () => {
    mockProvider.getOptionsChain.mockRejectedValue(new Error("TWS error"));
    await expect(optionsCollector.collect("AAPL")).rejects.toThrow("TWS error");
  });

  it("attaches IV Rank to the collected data", async () => {
    mockProvider.getOptionsChain.mockResolvedValue([
      { symbol: "AAPL", expiration: "2026-03-20", strike: 150, right: "C" as const, bid: 5, ask: 5.1, last: 5.05, volume: 100, openInterest: 0, impliedVolatility: 0.3, delta: 0.5, gamma: null, theta: null },
    ]);
    mockIvRankService.getIvRank.mockResolvedValue({
      info: {
        ivRank: 82, currentIv: 0.341, iv52wLow: 0.182,
        iv52wHigh: 0.395, windowDays: 252, asOf: "2026-08-10",
      },
      reason: null,
    });

    const result = await optionsCollector.collect("AAPL");

    const data = (result as { data: Record<string, unknown> }).data;
    expect((data.ivRank as { ivRank: number }).ivRank).toBe(82);
    expect(data.ivRankUnavailableReason).toBeNull();
  });

  it("passes the unavailability reason through instead of a value", async () => {
    mockProvider.getOptionsChain.mockResolvedValue([
      { symbol: "AAPL", expiration: "2026-03-20", strike: 150, right: "C" as const, bid: 5, ask: 5.1, last: 5.05, volume: 100, openInterest: 0, impliedVolatility: 0.3, delta: 0.5, gamma: null, theta: null },
    ]);
    mockIvRankService.getIvRank.mockResolvedValue({
      info: null,
      reason: "insufficient_history",
    });

    const result = await optionsCollector.collect("AAPL");

    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.ivRank).toBeNull();
    expect(data.ivRankUnavailableReason).toBe("insufficient_history");
  });
});
