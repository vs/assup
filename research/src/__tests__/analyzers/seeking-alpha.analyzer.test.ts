import { describe, it, expect } from "vitest";
import { seekingAlphaAnalyzer } from "../../analyzers/seeking-alpha.analyzer.js";

describe("seekingAlphaAnalyzer", () => {
  it("returns neutral for null ratings", async () => {
    const result = await seekingAlphaAnalyzer.analyze({ ratings: null });
    expect(result.signal).toBe("neutral");
    expect(result.summary).toContain("No Seeking Alpha");
  });

  it("returns neutral for empty input", async () => {
    const result = await seekingAlphaAnalyzer.analyze({});
    expect(result.signal).toBe("neutral");
  });

  it("signals bullish for strong_buy quant + buy wall street", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: {
        data: {
          attributes: {
            quantRating: "strong_buy",
            wallStreetRating: "buy",
            saAuthorsRating: "hold",
          },
        },
      },
    });
    expect(result.signal).toBe("bullish");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("signals bearish for strong_sell quant + sell wall street", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: {
        data: {
          attributes: {
            quantRating: "strong_sell",
            wallStreetRating: "sell",
            saAuthorsRating: "hold",
          },
        },
      },
    });
    expect(result.signal).toBe("bearish");
  });

  it("signals neutral for all hold ratings", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: {
        data: { attributes: { quantRating: "hold", wallStreetRating: "hold", saAuthorsRating: "hold" } },
      },
    });
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0);
  });

  it("handles missing attributes gracefully", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: { data: {} },
    });
    expect(result.signal).toBe("neutral");
  });

  it("ignores unknown rating values", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: {
        data: { attributes: { quantRating: "unknown_value" } },
      },
    });
    expect(result.signal).toBe("neutral");
  });

  it("weights quant rating 2x", async () => {
    const result = await seekingAlphaAnalyzer.analyze({
      ratings: {
        data: { attributes: { quantRating: "buy" } },
      },
    });
    expect(result.signal).toBe("bullish");
  });
});
