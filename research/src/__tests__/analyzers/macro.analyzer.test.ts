import { describe, it, expect } from "vitest";
import { macroAnalyzer } from "../../analyzers/macro.analyzer.js";

describe("macroAnalyzer", () => {
  it("returns neutral for all-null data", async () => {
    const result = await macroAnalyzer.analyze({});
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0);
    const details = result.details as Record<string, unknown>;
    expect(details.regime).toBe("neutral");
  });

  it("signals bullish (risk_on) for low VIX + SPY above 200-SMA", async () => {
    const result = await macroAnalyzer.analyze({
      vix: 15, vixSma20: 16, sp500Price: 500, sp500Sma200: 480,
    });
    expect(result.signal).toBe("bullish");
    const details = result.details as Record<string, unknown>;
    expect(details.regime).toBe("risk_on");
  });

  it("signals bearish (risk_off) for high VIX + SPY below 200-SMA", async () => {
    const result = await macroAnalyzer.analyze({
      vix: 30, vixSma20: 25, sp500Price: 450, sp500Sma200: 480,
    });
    expect(result.signal).toBe("bearish");
    const details = result.details as Record<string, unknown>;
    expect(details.regime).toBe("risk_off");
  });

  it("determines VIX trend correctly", async () => {
    const rising = await macroAnalyzer.analyze({ vix: 22, vixSma20: 20 });
    expect((rising.details as Record<string, unknown>).vixTrend).toBe("rising");

    const falling = await macroAnalyzer.analyze({ vix: 18, vixSma20: 20 });
    expect((falling.details as Record<string, unknown>).vixTrend).toBe("falling");

    const stable = await macroAnalyzer.analyze({ vix: 20, vixSma20: 20 });
    expect((stable.details as Record<string, unknown>).vixTrend).toBe("stable");
  });

  it("handles vixSma20 = 0 without division by zero", async () => {
    const result = await macroAnalyzer.analyze({ vix: 20, vixSma20: 0 });
    expect((result.details as Record<string, unknown>).vixTrend).toBe("stable");
  });

  it("handles null vixSma20", async () => {
    const result = await macroAnalyzer.analyze({ vix: 20, vixSma20: null });
    expect((result.details as Record<string, unknown>).vixTrend).toBe("stable");
  });

  it("includes put/call ratio in scoring when present", async () => {
    const bullishPCR = await macroAnalyzer.analyze({
      vix: 15, sp500Price: 500, sp500Sma200: 480, putCallRatio: 0.5,
    });
    const bearishPCR = await macroAnalyzer.analyze({
      vix: 15, sp500Price: 500, sp500Sma200: 480, putCallRatio: 1.5,
    });
    expect(bullishPCR.confidence).toBeGreaterThanOrEqual(bearishPCR.confidence);
  });

  it("SPY trend is unknown when data missing", async () => {
    const result = await macroAnalyzer.analyze({ vix: 20 });
    expect((result.details as Record<string, unknown>).sp500Trend).toBe("unknown");
  });

  it("confidence scales with signal agreement", async () => {
    const allAgree = await macroAnalyzer.analyze({
      vix: 15, sp500Price: 500, sp500Sma200: 480, putCallRatio: 0.5,
    });
    const mixed = await macroAnalyzer.analyze({
      vix: 30, sp500Price: 500, sp500Sma200: 480, putCallRatio: 0.5,
    });
    expect(allAgree.confidence).toBeGreaterThan(mixed.confidence);
  });
});
