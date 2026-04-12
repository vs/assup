import { describe, it, expect } from "vitest";
import { seekingAlphaAnalyzer } from "../../../services/research/analyzers/seeking-alpha.analyzer.js";

describe("seekingAlphaAnalyzer", () => {
  it("returns neutral for null metrics", async () => {
    const result = await seekingAlphaAnalyzer.analyze({ metrics: null });
    expect(result.signal).toBe("neutral");
    expect(result.summary).toContain("No Seeking Alpha");
  });

  it("returns neutral for empty input", async () => {
    const result = await seekingAlphaAnalyzer.analyze({});
    expect(result.signal).toBe("neutral");
  });

  it("includes metrics in summary", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      metrics: {
        pe_nongaap_fy1: 25.3,
        revenue_growth: 65.4,
      },
    });
    expect(result.summary).toContain("Fwd P/E: 25.3");
    expect(result.summary).toContain("Revenue Growth: 65.4%");
  });

  it("signals bullish for high revenue growth", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      metrics: { revenue_growth: 65 },
    });
    expect(result.signal).toBe("bullish");
  });

  it("signals bearish for negative revenue growth", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      metrics: { revenue_growth: -15 },
    });
    expect(result.signal).toBe("bearish");
  });

  it("signals neutral for moderate metrics", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      metrics: { pe_nongaap_fy1: 20, revenue_growth: 5 },
    });
    expect(result.signal).toBe("neutral");
  });

  it("includes dividend yield in summary", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      metrics: { dividend_yield: 3.5 },
    });
    expect(result.summary).toContain("Dividend Yield: 3.50%");
  });

  it("includes market cap in summary", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      metrics: { marketcap: 2500000000000 },
    });
    expect(result.summary).toContain("Market Cap: $2500.0B");
  });

  it("returns metrics and rawScore in details", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      metrics: { revenue_growth: 30 },
    });
    expect(result.details.metrics).toEqual({ revenue_growth: 30 });
    expect(result.details.rawScore).toBe(1);
  });
});
