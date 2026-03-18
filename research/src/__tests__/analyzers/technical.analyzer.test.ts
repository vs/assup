import { describe, it, expect } from "vitest";
import { technicalAnalyzer } from "../../analyzers/technical.analyzer.js";
import { generateOHLCV } from "../fixtures/ohlcv.js";

describe("technicalAnalyzer", () => {
  it("returns neutral with 0 confidence for empty OHLCV", async () => {
    const result = await technicalAnalyzer.analyze({ ohlcv: [], currentPrice: 0 });
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0);
    expect(result.summary).toContain("No OHLCV data");
  });

  it("returns neutral with 0 confidence for null OHLCV", async () => {
    const result = await technicalAnalyzer.analyze({});
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0);
  });

  it("computes details for strong uptrend data", async () => {
    // With a uniform uptrend, RSI is overbought (~100) which counteracts the
    // bullish trend signal, resulting in neutral. This test verifies the analyzer
    // returns correct details structure for uptrend data.
    const ohlcv = generateOHLCV(250, { startPrice: 50, trend: "up" });
    const currentPrice = ohlcv[ohlcv.length - 1].close + 10;

    const result = await technicalAnalyzer.analyze({ ohlcv, currentPrice });
    // RSI overbought (-2) cancels strong_uptrend (+2), MACD positive (+1) → score 1 → neutral
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.summary).not.toBe("");
    expect(result.details).toHaveProperty("trend");
    expect(result.details).toHaveProperty("rsi14");
    expect(result.details).toHaveProperty("sma50");
    expect(result.details).toHaveProperty("sma200");
  });

  it("returns neutral for strong downtrend with oversold RSI", async () => {
    // With a uniform downtrend, RSI is deeply oversold (~0) which counteracts
    // the bearish trend signal, resulting in neutral.
    const ohlcv = generateOHLCV(250, { startPrice: 200, trend: "down" });
    const currentPrice = ohlcv[ohlcv.length - 1].close - 10;

    const result = await technicalAnalyzer.analyze({ ohlcv, currentPrice });
    // RSI oversold (+2) cancels strong_downtrend (-2), MACD negative (-1) → score -1 → neutral
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns neutral for insufficient data (< 50 points)", async () => {
    const ohlcv = generateOHLCV(10);
    const currentPrice = ohlcv[ohlcv.length - 1].close;

    const result = await technicalAnalyzer.analyze({ ohlcv, currentPrice });
    expect(result.signal).toBe("neutral");
  });

  it("includes volume trend in details", async () => {
    const ohlcv = generateOHLCV(30);
    const result = await technicalAnalyzer.analyze({
      ohlcv,
      currentPrice: ohlcv[ohlcv.length - 1].close,
    });
    expect(result.details).toHaveProperty("volumeTrend");
    expect(result.details).toHaveProperty("volumeRatio");
  });

  it("includes support and resistance when enough data", async () => {
    const ohlcv = generateOHLCV(25);
    const result = await technicalAnalyzer.analyze({
      ohlcv,
      currentPrice: ohlcv[ohlcv.length - 1].close,
    });
    expect(result.details).toHaveProperty("support");
    expect(result.details).toHaveProperty("resistance");
    expect((result.details as Record<string, unknown>).support).toBeTypeOf("number");
  });

  it("handles MACD details as nullable", async () => {
    const ohlcv = generateOHLCV(20);
    const result = await technicalAnalyzer.analyze({
      ohlcv,
      currentPrice: ohlcv[ohlcv.length - 1].close,
    });
    const details = result.details as Record<string, unknown>;
    if (details.macd !== null) {
      const macd = details.macd as Record<string, unknown>;
      expect(macd).toHaveProperty("macd");
    }
  });

  it("summary falls back when no signals generated", async () => {
    const ohlcv = generateOHLCV(5);
    const result = await technicalAnalyzer.analyze({ ohlcv, currentPrice: 50 });
    expect(result.summary.length).toBeGreaterThan(1);
    expect(result.summary).not.toBe(".");
  });

  it("confidence is capped at 1", async () => {
    const ohlcv = generateOHLCV(250, { startPrice: 50, trend: "up" });
    const result = await technicalAnalyzer.analyze({
      ohlcv,
      currentPrice: ohlcv[ohlcv.length - 1].close + 50,
    });
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });
});
