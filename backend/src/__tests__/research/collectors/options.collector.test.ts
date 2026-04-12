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

import { ibkrService } from "../../../services/ibkr.js";
import { createIBKRProvider } from "../../../services/research/providers/ibkr.provider.js";

const mockIbkrService = vi.mocked(ibkrService);
const mockCreateIBKRProvider = vi.mocked(createIBKRProvider);

describe("optionsCollector", () => {
  const mockProvider = {
    name: "ibkr",
    getOptionsChain: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockIbkrService.isConnected.mockReturnValue(true);
    mockCreateIBKRProvider.mockReturnValue(mockProvider as any);
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
});
