import { describe, it, expect } from "vitest";
import { seekingAlphaAnalyzer } from "../../analyzers/seeking-alpha.analyzer.js";

describe("seekingAlphaAnalyzer", () => {
  it("returns neutral for null ratings and metrics", async () => {
    const result = await seekingAlphaAnalyzer.analyze({ ratings: null, metrics: null });
    expect(result.signal).toBe("neutral");
    expect(result.summary).toContain("No Seeking Alpha");
  });

  it("returns neutral for empty input", async () => {
    const result = await seekingAlphaAnalyzer.analyze({});
    expect(result.signal).toBe("neutral");
  });

  it("signals bullish for high sell-side rating", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: {
        data: [{ attributes: { ratings: { sellSideRating: 4.7 } }, meta: { period: 0 } }],
      },
      metrics: null,
    });
    expect(result.signal).toBe("bullish");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.summary).toContain("Strong Buy");
  });

  it("signals bearish for low sell-side rating", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: {
        data: [{ attributes: { ratings: { sellSideRating: 1.3 } }, meta: { period: 0 } }],
      },
      metrics: null,
    });
    expect(result.signal).toBe("bearish");
    expect(result.summary).toContain("Strong Sell");
  });

  it("signals neutral for hold-range sell-side rating", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: {
        data: [{ attributes: { ratings: { sellSideRating: 3.0 } }, meta: { period: 0 } }],
      },
      metrics: null,
    });
    expect(result.signal).toBe("neutral");
    expect(result.summary).toContain("Hold");
  });

  it("includes quant and authors ratings when available", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: {
        data: [{
          attributes: { ratings: { sellSideRating: 4.5, quantRating: 4.2, authorsRating: 3.8 } },
          meta: { period: 0, is_locked: false },
        }],
      },
      metrics: null,
    });
    expect(result.signal).toBe("bullish");
    expect(result.summary).toContain("Quant");
    expect(result.summary).toContain("SA Authors");
    expect(result.details.quantRating).toBe(4.2);
    expect(result.details.authorsRating).toBe(3.8);
  });

  it("includes metrics in summary", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: {
        data: [{ attributes: { ratings: { sellSideRating: 3.5 } }, meta: { period: 0 } }],
      },
      metrics: {
        pe_nongaap_fy1: 25.3,
        revenue_growth: 0.654,
        short_interest_shares_outstanding: 1.05,
      },
    });
    expect(result.summary).toContain("Fwd P/E: 25.3");
    expect(result.summary).toContain("Revenue Growth: 65.4%");
    expect(result.summary).toContain("Short Interest: 105.0%");
  });

  it("boosts score for high revenue growth", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: {
        data: [{ attributes: { ratings: { sellSideRating: 3.8 } }, meta: { period: 0 } }],
      },
      metrics: { revenue_growth: 0.65 },
    });
    // sellSideRating 3.8 = Buy (score +1*2=2), revenue_growth > 0.2 (score +1) => total 3 => bullish
    expect(result.signal).toBe("bullish");
  });

  it("handles missing ratings data array gracefully", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: { data: [] },
      metrics: null,
    });
    expect(result.signal).toBe("neutral");
  });
});
