import { describe, it, expect } from "vitest";
import { analystConsensusAnalyzer } from "../../../services/research/analyzers/analyst-consensus.analyzer.js";

function makeRating(rating: string, action = "reiterate", priceTarget: number | null = 150) {
  return { firm: "TestFirm", rating, priceTarget, date: "2026-01-15", action };
}

describe("analystConsensusAnalyzer", () => {
  it("returns neutral with 0 confidence for empty ratings", async () => {
    const result = await analystConsensusAnalyzer.analyze({ ratings: [] });
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0);
    expect(result.summary).toContain("No analyst ratings");
  });

  it("returns neutral for undefined ratings", async () => {
    const result = await analystConsensusAnalyzer.analyze({});
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0);
  });

  it("signals bullish for majority buy ratings", async () => {
    const ratings = [
      makeRating("buy"), makeRating("buy"), makeRating("outperform"),
      makeRating("hold"), makeRating("hold"),
    ];
    const result = await analystConsensusAnalyzer.analyze({ ratings });
    expect(result.signal).toBe("bullish");
  });

  it("signals bearish for high sell ratings (>30%)", async () => {
    const ratings = [
      makeRating("sell"), makeRating("underperform"),
      makeRating("hold"), makeRating("hold"),
    ];
    const result = await analystConsensusAnalyzer.analyze({ ratings });
    expect(result.signal).toBe("bearish");
  });

  it("normalizes buy keywords correctly", async () => {
    const buyKeywords = ["buy", "outperform", "overweight", "strong buy", "positive"];
    for (const keyword of buyKeywords) {
      const result = await analystConsensusAnalyzer.analyze({
        ratings: [makeRating(keyword), makeRating(keyword), makeRating(keyword)],
      });
      const details = result.details as Record<string, unknown>;
      expect(details.buyCount).toBe(3);
    }
  });

  it("computes average price target from non-null values", async () => {
    const ratings = [
      makeRating("buy", "reiterate", 100),
      makeRating("buy", "reiterate", 200),
      makeRating("buy", "reiterate", null),
    ];
    const result = await analystConsensusAnalyzer.analyze({ ratings });
    const details = result.details as Record<string, unknown>;
    expect(details.avgPriceTarget).toBe(150);
  });

  it("detects upgrade momentum", async () => {
    const ratings = [
      makeRating("buy", "upgrade"),
      makeRating("buy", "upgrade"),
      makeRating("hold", "reiterate"),
    ];
    const result = await analystConsensusAnalyzer.analyze({ ratings });
    expect(result.summary).toContain("upgrade");
  });

  it("detects downgrade momentum", async () => {
    const ratings = [
      makeRating("sell", "downgrade"),
      makeRating("sell", "downgrade"),
      makeRating("hold", "reiterate"),
    ];
    const result = await analystConsensusAnalyzer.analyze({ ratings });
    expect(result.summary).toContain("downgrade");
  });

  it("defaults unknown ratings to hold", async () => {
    const result = await analystConsensusAnalyzer.analyze({
      ratings: [makeRating("market perform"), makeRating("equal-weight")],
    });
    const details = result.details as Record<string, unknown>;
    expect(details.holdCount).toBe(2);
    expect(details.buyCount).toBe(0);
    expect(details.sellCount).toBe(0);
  });
});
