import { describe, it, expect, vi, beforeEach } from "vitest";
import { technicalCollector } from "../../../services/research/collectors/technical.collector.js";

vi.mock("../../../services/research/providers/index.js", () => ({
  getMarketDataProvider: vi.fn(),
}));

import { getMarketDataProvider } from "../../../services/research/providers/index.js";

describe("technicalCollector", () => {
  const mockProvider = {
    name: "mock",
    getHistoricalOHLCV: vi.fn(),
    getQuote: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(getMarketDataProvider).mockReturnValue(mockProvider as any);
  });

  it("has correct source and schedule", () => {
    expect(technicalCollector.source).toBe("technical");
    expect(technicalCollector.defaultSchedule).toBe("0 18 * * 1-5");
    expect(technicalCollector.stalenessMinutes).toBe(1440);
  });

  it("collects OHLCV + quote and returns data", async () => {
    const ohlcv = [{ date: "2026-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000000 }];
    mockProvider.getHistoricalOHLCV.mockResolvedValue(ohlcv);
    mockProvider.getQuote.mockResolvedValue({
      symbol: "AAPL", last: 150, close: 148, open: 149, high: 151, low: 147, volume: 500000,
    });

    const result = await technicalCollector.collect("AAPL");
    expect(result.source).toBe("technical");
    expect(result.data.ohlcv).toEqual(ohlcv);
    expect(result.data.currentPrice).toBe(150);
    expect(result.data.symbol).toBe("AAPL");
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("uses last OHLCV close as fallback when quote fails", async () => {
    const ohlcv = [{ date: "2026-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000000 }];
    mockProvider.getHistoricalOHLCV.mockResolvedValue(ohlcv);
    mockProvider.getQuote.mockRejectedValue(new Error("API error"));

    const result = await technicalCollector.collect("AAPL");
    expect(result.data.currentPrice).toBe(102);
  });

  it("throws when no OHLCV data returned", async () => {
    mockProvider.getHistoricalOHLCV.mockResolvedValue([]);

    await expect(technicalCollector.collect("AAPL")).rejects.toThrow("No OHLCV data returned");
  });

  it("requests 365 days of history", async () => {
    mockProvider.getHistoricalOHLCV.mockResolvedValue([
      { date: "2026-01-01", open: 100, high: 105, low: 95, close: 102, volume: 1000000 },
    ]);
    mockProvider.getQuote.mockResolvedValue({
      symbol: "AAPL", last: 150, close: null, open: null, high: null, low: null, volume: null,
    });

    await technicalCollector.collect("AAPL");
    expect(mockProvider.getHistoricalOHLCV).toHaveBeenCalledWith(
      "AAPL",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      "day"
    );
  });
});
