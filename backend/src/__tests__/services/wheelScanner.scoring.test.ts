import { describe, it, expect } from "vitest";
import {
  scoreIvRank,
  scorePutLiquidity,
  scorePremiumYield,
  scoreMarketCap,
  scorePriceRange,
  scoreAllocationNeed,
  computeCompositeScore,
} from "../../services/wheelScanner.scoring.js";

describe("wheelScanner scoring", () => {
  describe("scoreIvRank", () => {
    it("returns 0 for ivRank 0", () => {
      expect(scoreIvRank(0)).toBe(0);
    });
    it("returns 100 for ivRank 100+", () => {
      expect(scoreIvRank(100)).toBe(100);
      expect(scoreIvRank(120)).toBe(100);
    });
    it("returns proportional score", () => {
      expect(scoreIvRank(50)).toBe(50);
    });
  });

  describe("scorePutLiquidity", () => {
    it("returns 100 for 0% spread", () => {
      expect(scorePutLiquidity(0)).toBe(100);
    });
    it("returns 0 for 20%+ spread", () => {
      expect(scorePutLiquidity(0.2)).toBe(0);
      expect(scorePutLiquidity(0.3)).toBe(0);
    });
    it("returns proportional score", () => {
      expect(scorePutLiquidity(0.1)).toBe(50);
    });
  });

  describe("scorePremiumYield", () => {
    it("returns 100 for 30%+ annualized", () => {
      expect(scorePremiumYield(30)).toBe(100);
      expect(scorePremiumYield(50)).toBe(100);
    });
    it("returns proportional score", () => {
      expect(scorePremiumYield(15)).toBe(50);
    });
    it("returns 0 for 0 yield", () => {
      expect(scorePremiumYield(0)).toBe(0);
    });
  });

  describe("scoreMarketCap", () => {
    it("returns 0 for sub-1B market cap", () => {
      expect(scoreMarketCap(500_000_000)).toBe(0);
    });
    it("returns 100 for 500B+", () => {
      expect(scoreMarketCap(500_000_000_000)).toBe(100);
    });
    it("returns intermediate score for mid-cap", () => {
      const score = scoreMarketCap(50_000_000_000);
      expect(score).toBeGreaterThan(40);
      expect(score).toBeLessThan(80);
    });
  });

  describe("scorePriceRange", () => {
    it("returns highest score around $50-100", () => {
      const at75 = scorePriceRange(75);
      const at20 = scorePriceRange(20);
      const at400 = scorePriceRange(400);
      expect(at75).toBeGreaterThan(at20);
      expect(at75).toBeGreaterThan(at400);
    });
  });

  describe("scoreAllocationNeed", () => {
    it("returns 0 for 0 shortfall", () => {
      expect(scoreAllocationNeed(0)).toBe(0);
    });
    it("returns 100 for 10%+ shortfall", () => {
      expect(scoreAllocationNeed(10)).toBe(100);
    });
    it("returns proportional score", () => {
      expect(scoreAllocationNeed(5)).toBe(50);
    });
  });

  describe("computeCompositeScore", () => {
    it("computes weighted average", () => {
      const score = computeCompositeScore({
        ivRank: 100,
        putLiquidity: 100,
        premiumYield: 100,
        marketCap: 100,
        priceRange: 100,
        allocationNeed: 100,
      });
      expect(score).toBe(100);
    });

    it("returns 0 for all zeros", () => {
      const score = computeCompositeScore({
        ivRank: 0,
        putLiquidity: 0,
        premiumYield: 0,
        marketCap: 0,
        priceRange: 0,
        allocationNeed: 0,
      });
      expect(score).toBe(0);
    });
  });
});
