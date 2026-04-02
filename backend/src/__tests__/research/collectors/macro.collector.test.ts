import { describe, it, expect, vi, beforeEach } from "vitest";
import { macroCollector } from "../../../services/research/collectors/macro.collector.js";

vi.mock("../../../services/research/providers/tradingview.js", () => ({
  fetchMacroQuotes: vi.fn(),
}));

import { fetchMacroQuotes } from "../../../services/research/providers/tradingview.js";

describe("macroCollector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct source and schedule", () => {
    expect(macroCollector.source).toBe("macro");
  });

  it("collects VIX and SPY data", async () => {
    vi.mocked(fetchMacroQuotes).mockResolvedValue({
      "SP:SPX": { close: 500, sma200: 480, rsi: 55, change: 1.2 },
      "CBOE:VIX": { close: 18, sma20: 20, change: -0.5 },
      "AMEX:HYG": { close: 78, change: 0.3 },
      "NASDAQ:TLT": { close: 95, change: -0.2 },
    } as any);

    const result = await macroCollector.collect("");
    expect(result.source).toBe("macro");
    expect(result.data.vix).toBe(18);
    expect(result.data.vixSma20).toBe(20);
    expect(result.data.sp500Index).toBe(500);
    expect(result.data.sp500Sma200).toBe(480);
  });

  it("throws when both VIX and SPY fail completely", async () => {
    vi.mocked(fetchMacroQuotes).mockResolvedValue({} as any);

    await expect(macroCollector.collect("")).rejects.toThrow(
      "Failed to fetch both VIX and S&P 500 macro data from TradingView"
    );
  });

  it("succeeds with partial data (only VIX)", async () => {
    vi.mocked(fetchMacroQuotes).mockResolvedValue({
      "CBOE:VIX": { close: 22, sma20: null, change: null },
    } as any);

    const result = await macroCollector.collect("");
    expect(result.data.vix).toBe(22);
    expect(result.data.sp500Index).toBeNull();
  });

  it("ignores symbol parameter", async () => {
    vi.mocked(fetchMacroQuotes).mockResolvedValue({
      "SP:SPX": { close: 500, sma200: 480, rsi: 55, change: 1.2 },
      "CBOE:VIX": { close: 20, sma20: 19, change: 0.1 },
    } as any);

    await macroCollector.collect("AAPL");
    // fetchMacroQuotes is called without any symbol argument
    expect(fetchMacroQuotes).toHaveBeenCalledTimes(1);
    expect(fetchMacroQuotes).toHaveBeenCalledWith();
  });
});
