import { describe, it, expect } from "vitest";
import { shortInterestAnalyzer } from "../../../services/research/analyzers/short-interest.analyzer.js";

describe("shortInterestAnalyzer", () => {
  it("returns neutral with low confidence for zero data (insufficient)", async () => {
    const result = await shortInterestAnalyzer.analyze({
      shortPercentOfSO: 0,
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

  it("signals bearish for extreme short interest with increasing trend", async () => {
    const result = await shortInterestAnalyzer.analyze({
      shortPercentOfSO: 20,
      daysToCover: 12,
      shortInterestTrend: "increasing",
    });
    expect(result.signal).toBe("bearish");
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it("signals bullish for low short interest with decreasing trend", async () => {
    const result = await shortInterestAnalyzer.analyze({
      shortPercentOfSO: 2,
      daysToCover: 1.5,
      shortInterestTrend: "decreasing",
    });
    expect(result.signal).toBe("bullish");
  });

  it("detects short squeeze potential (high short + decreasing)", async () => {
    const result = await shortInterestAnalyzer.analyze({
      shortPercentOfSO: 10,
      daysToCover: 5,
      shortInterestTrend: "decreasing",
    });
    expect(result.signal).toBe("bullish");
    expect(result.summary).toContain("squeeze");
  });

  it("classifies short levels correctly", async () => {
    // Extreme: >= 15%
    const extreme = await shortInterestAnalyzer.analyze({
      shortPercentOfSO: 20, daysToCover: 0,
    });
    expect((extreme.details as Record<string, unknown>).shortLevel).toBe("extreme");

    // High: >= 8%
    const high = await shortInterestAnalyzer.analyze({
      shortPercentOfSO: 10, daysToCover: 0,
    });
    expect((high.details as Record<string, unknown>).shortLevel).toBe("high");

    // Moderate: >= 4%
    const moderate = await shortInterestAnalyzer.analyze({
      shortPercentOfSO: 5, daysToCover: 0,
    });
    expect((moderate.details as Record<string, unknown>).shortLevel).toBe("moderate");

    // Low: < 4%
    const low = await shortInterestAnalyzer.analyze({
      shortPercentOfSO: 2, daysToCover: 0,
    });
    expect((low.details as Record<string, unknown>).shortLevel).toBe("low");
  });

  it("has higher baseline confidence with real SA data", async () => {
    const result = await shortInterestAnalyzer.analyze({
      shortPercentOfSO: 5,
    });
    // confidence = abs(0)/4 + 0.3 = 0.3 minimum (moderate, score=0)
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it("uses S/O label in summary", async () => {
    const result = await shortInterestAnalyzer.analyze({
      shortPercentOfSO: 10,
    });
    expect(result.summary).toContain("S/O");
    expect(result.summary).not.toContain("float");
  });
});
