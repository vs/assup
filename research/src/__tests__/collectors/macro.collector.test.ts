import { describe, it, expect, vi, beforeEach } from "vitest";
import { macroCollector } from "../../collectors/macro.collector.js";

vi.mock("../../providers/index.js", () => ({
  getMarketDataProvider: vi.fn(),
}));

import { getMarketDataProvider } from "../../providers/index.js";

describe("macroCollector", () => {
  const mockProvider = {
    name: "mock",
    getQuote: vi.fn(),
    getHistoricalOHLCV: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(getMarketDataProvider).mockReturnValue(mockProvider as any);
  });

  it("has correct source and schedule", () => {
    expect(macroCollector.source).toBe("macro");
  });

  it("collects VIX and SPY data", async () => {
    const vixHist = Array.from({ length: 25 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      open: 20, high: 21, low: 19, close: 20, volume: 1000,
    }));
    const spyHist = Array.from({ length: 210 }, (_, i) => ({
      date: `2025-06-${String((i % 28) + 1).padStart(2, "0")}`,
      open: 480, high: 485, low: 475, close: 480, volume: 100000,
    }));

    mockProvider.getQuote.mockImplementation((symbol: string) => {
      if (symbol === "VIX") return Promise.resolve({ symbol: "VIX", last: 18, close: 19, open: 18, high: 20, low: 17, volume: null });
      return Promise.resolve({ symbol: "SPY", last: 500, close: 498, open: 497, high: 502, low: 495, volume: 50000000 });
    });
    mockProvider.getHistoricalOHLCV.mockImplementation((symbol: string) => {
      if (symbol === "VIX") return Promise.resolve(vixHist);
      return Promise.resolve(spyHist);
    });

    const result = await macroCollector.collect("");
    expect(result.source).toBe("macro");
    expect(result.data.vix).toBe(18);
    expect(result.data.vixSma20).toBeTypeOf("number");
    expect(result.data.sp500Price).toBe(500);
    expect(result.data.sp500Sma200).toBeTypeOf("number");
  });

  it("throws when both VIX and SPY fail completely", async () => {
    mockProvider.getQuote.mockRejectedValue(new Error("API error"));
    mockProvider.getHistoricalOHLCV.mockRejectedValue(new Error("API error"));

    await expect(macroCollector.collect("")).rejects.toThrow("Failed to fetch both VIX and SPY");
  });

  it("succeeds with partial data (only VIX quote)", async () => {
    mockProvider.getQuote.mockImplementation((symbol: string) => {
      if (symbol === "VIX") return Promise.resolve({ symbol: "VIX", last: 22, close: null, open: null, high: null, low: null, volume: null });
      return Promise.reject(new Error("fail"));
    });
    mockProvider.getHistoricalOHLCV.mockRejectedValue(new Error("fail"));

    const result = await macroCollector.collect("");
    expect(result.data.vix).toBe(22);
    expect(result.data.sp500Price).toBeNull();
  });

  it("ignores symbol parameter", async () => {
    mockProvider.getQuote.mockResolvedValue({ symbol: "VIX", last: 20, close: null, open: null, high: null, low: null, volume: null });
    mockProvider.getHistoricalOHLCV.mockResolvedValue([]);

    await macroCollector.collect("AAPL");
    expect(mockProvider.getQuote).toHaveBeenCalledWith("VIX");
    expect(mockProvider.getQuote).toHaveBeenCalledWith("SPY");
    expect(mockProvider.getQuote).not.toHaveBeenCalledWith("AAPL");
  });
});
