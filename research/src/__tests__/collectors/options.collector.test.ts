import { describe, it, expect, vi, beforeEach } from "vitest";
import { optionsCollector } from "../../collectors/options.collector.js";

vi.mock("../../providers/index.js", () => ({
  getMarketDataProvider: vi.fn(),
}));

import { getMarketDataProvider } from "../../providers/index.js";

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
    expect(result.source).toBe("options");
    expect(result.data.chain).toEqual(chain);
    expect(result.data.symbol).toBe("AAPL");
  });

  it("throws when no chain data returned", async () => {
    mockProvider.getOptionsChain.mockResolvedValue([]);
    await expect(optionsCollector.collect("AAPL")).rejects.toThrow("No options chain data");
  });

  it("requests 4 expirations", async () => {
    mockProvider.getOptionsChain.mockResolvedValue([
      { symbol: "AAPL", expiration: "2026-03-20", strike: 150, right: "C" as const, bid: 5, ask: 5.1, last: 5.05, volume: 100, openInterest: 500, impliedVolatility: 0.3, delta: 0.5, gamma: 0.03, theta: -0.05 },
    ]);
    await optionsCollector.collect("AAPL");
    expect(mockProvider.getOptionsChain).toHaveBeenCalledWith("AAPL", 4);
  });
});
