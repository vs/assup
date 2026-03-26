import { describe, it, expect, vi, beforeEach } from "vitest";
import { analystConsensusCollector } from "../../../services/research/collectors/analyst-consensus.collector.js";

vi.mock("../../../services/research/providers/index.js", () => ({
  getMarketDataProvider: vi.fn(),
}));

import { getMarketDataProvider } from "../../../services/research/providers/index.js";

describe("analystConsensusCollector", () => {
  const mockProvider = {
    name: "mock",
    getAnalystRatings: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(getMarketDataProvider).mockReturnValue(mockProvider as any);
  });

  it("has correct source and schedule", () => {
    expect(analystConsensusCollector.source).toBe("analyst_consensus");
    expect(analystConsensusCollector.stalenessMinutes).toBe(1440);
  });

  it("collects ratings and computes counts", async () => {
    mockProvider.getAnalystRatings.mockResolvedValue([
      { firm: "GS", rating: "buy", priceTarget: 200, date: "2026-01-15", action: "reiterate" },
      { firm: "JPM", rating: "sell", priceTarget: 120, date: "2026-01-10", action: "downgrade" },
      { firm: "MS", rating: "hold", priceTarget: 160, date: "2026-01-05", action: "initiate" },
    ]);

    const result = await analystConsensusCollector.collect("AAPL");
    expect(result.source).toBe("analyst_consensus");
    expect(result.data.buyCount).toBe(1);
    expect(result.data.holdCount).toBe(1);
    expect(result.data.sellCount).toBe(1);
    expect(result.data.avgPriceTarget).toBe(160);
  });

  it("returns null avgPriceTarget when all targets are null", async () => {
    mockProvider.getAnalystRatings.mockResolvedValue([
      { firm: "GS", rating: "buy", priceTarget: null, date: "2026-01-15", action: "reiterate" },
    ]);

    const result = await analystConsensusCollector.collect("AAPL");
    expect(result.data.avgPriceTarget).toBeNull();
  });

  it("handles empty ratings array", async () => {
    mockProvider.getAnalystRatings.mockResolvedValue([]);

    const result = await analystConsensusCollector.collect("AAPL");
    expect(result.data.buyCount).toBe(0);
    expect(result.data.holdCount).toBe(0);
    expect(result.data.sellCount).toBe(0);
  });
});
