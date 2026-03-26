import { describe, it, expect, vi, beforeEach } from "vitest";
import { optionsCollector } from "../../../services/research/collectors/options.collector.js";
import type { SkippedCollection } from "../../../services/research/collectors/types.js";

vi.mock("../../../services/research/providers/index.js", () => ({
  getMarketDataProvider: vi.fn(),
}));

import { getMarketDataProvider } from "../../../services/research/providers/index.js";

describe("optionsCollector", () => {
  const mockProvider = {
    name: "mock",
    getOptionsChain: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(getMarketDataProvider).mockReturnValue(mockProvider as any);
  });

  it("has correct source and schedule", () => {
    expect(optionsCollector.source).toBe("options");
    expect(optionsCollector.stalenessMinutes).toBe(1440);
  });

  it("collects options chain and returns data", async () => {
    const chain = [{ symbol: "AAPL", expiration: "2026-03-20", strike: 150, right: "C" as const, bid: 5, ask: 5.1, last: 5.05, volume: 100, openInterest: 500, impliedVolatility: 0.3, delta: 0.5, gamma: 0.03, theta: -0.05 }];
    mockProvider.getOptionsChain.mockResolvedValue(chain);

    const result = await optionsCollector.collect("AAPL");
    expect(result).not.toHaveProperty("_tag");
    expect(result.source).toBe("options");
    expect((result as any).data.chain).toEqual(chain);
    expect((result as any).data.symbol).toBe("AAPL");
  });

  it("throws when no chain data returned", async () => {
    mockProvider.getOptionsChain.mockResolvedValue([]);
    await expect(optionsCollector.collect("AAPL")).rejects.toThrow("No options chain data");
  });

  it("returns SkippedCollection when provider returns 403", async () => {
    mockProvider.getOptionsChain.mockRejectedValue(new Error("Polygon API error 403: NOT_AUTHORIZED"));
    const result = await optionsCollector.collect("AAPL");
    expect(result).toMatchObject({
      _tag: "skipped",
      source: "options",
    });
    expect((result as SkippedCollection).reason).toContain("403");
  });

  it("returns SkippedCollection when provider returns 404", async () => {
    mockProvider.getOptionsChain.mockRejectedValue(new Error("Polygon API error 404: Not Found"));
    const result = await optionsCollector.collect("AAPL");
    expect(result).toMatchObject({
      _tag: "skipped",
      source: "options",
    });
    expect((result as SkippedCollection).reason).toContain("404");
  });

  it("rethrows other provider errors", async () => {
    mockProvider.getOptionsChain.mockRejectedValue(new Error("Polygon API error 500: Internal Server Error"));
    await expect(optionsCollector.collect("AAPL")).rejects.toThrow("500");
  });

  it("requests 4 expirations", async () => {
    mockProvider.getOptionsChain.mockResolvedValue([
      { symbol: "AAPL", expiration: "2026-03-20", strike: 150, right: "C" as const, bid: 5, ask: 5.1, last: 5.05, volume: 100, openInterest: 500, impliedVolatility: 0.3, delta: 0.5, gamma: 0.03, theta: -0.05 },
    ]);
    await optionsCollector.collect("AAPL");
    expect(mockProvider.getOptionsChain).toHaveBeenCalledWith("AAPL", 4);
  });
});
