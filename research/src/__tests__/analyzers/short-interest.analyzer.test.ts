import { describe, it, expect } from "vitest";
import { shortInterestAnalyzer } from "../../analyzers/short-interest.analyzer.js";

describe("shortInterestAnalyzer", () => {
  it("returns neutral with low confidence for zero data (insufficient)", async () => {
    const result = await shortInterestAnalyzer.analyze({
      shortPercentOfFloat: 0,
      daysToCover: 0,
      shortInterestTrend: "unknown",
    });
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0.1);
    expect(result.summary).toContain("Insufficient");
  });

  it("returns neutral for empty input", async () => {
    const result = await shortInterestAnalyzer.analyze({});
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0.1);
  });

  it("signals bearish for extreme short interest", async () => {
    const result = await shortInterestAnalyzer.analyze({
      shortPercentOfFloat: 25,
      daysToCover: 12,
      shortInterestTrend: "increasing",
      historicalEntries: [{}, {}],
    });
    expect(result.signal).toBe("bearish");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("signals bullish for low short interest with decreasing trend", async () => {
    const result = await shortInterestAnalyzer.analyze({
      shortPercentOfFloat: 2,
      daysToCover: 1.5,
      shortInterestTrend: "decreasing",
      historicalEntries: [{}, {}],
    });
    expect(result.signal).toBe("bullish");
  });

  it("detects short squeeze potential (high short + decreasing)", async () => {
    const result = await shortInterestAnalyzer.analyze({
      shortPercentOfFloat: 15,
      daysToCover: 5,
      shortInterestTrend: "decreasing",
      historicalEntries: [{}, {}],
    });
    expect(result.signal).toBe("bullish");
    expect(result.summary).toContain("squeeze");
  });

  it("reduces confidence with < 2 historical entries", async () => {
    const withHistory = await shortInterestAnalyzer.analyze({
      shortPercentOfFloat: 15,
      daysToCover: 5,
      shortInterestTrend: "increasing",
      historicalEntries: [{}, {}],
    });
    const withoutHistory = await shortInterestAnalyzer.analyze({
      shortPercentOfFloat: 15,
      daysToCover: 5,
      shortInterestTrend: "increasing",
      historicalEntries: [{}],
    });
    expect(withoutHistory.confidence).toBeLessThan(withHistory.confidence);
  });

  it("classifies short levels correctly", async () => {
    const extreme = await shortInterestAnalyzer.analyze({
      shortPercentOfFloat: 25, daysToCover: 5, historicalEntries: [{}, {}],
    });
    expect((extreme.details as Record<string, unknown>).shortLevel).toBe("extreme");

    const high = await shortInterestAnalyzer.analyze({
      shortPercentOfFloat: 12, daysToCover: 5, historicalEntries: [{}, {}],
    });
    expect((high.details as Record<string, unknown>).shortLevel).toBe("high");

    const moderate = await shortInterestAnalyzer.analyze({
      shortPercentOfFloat: 7, daysToCover: 5, historicalEntries: [{}, {}],
    });
    expect((moderate.details as Record<string, unknown>).shortLevel).toBe("moderate");

    const low = await shortInterestAnalyzer.analyze({
      shortPercentOfFloat: 3, daysToCover: 1, historicalEntries: [{}, {}],
    });
    expect((low.details as Record<string, unknown>).shortLevel).toBe("low");
  });
});
