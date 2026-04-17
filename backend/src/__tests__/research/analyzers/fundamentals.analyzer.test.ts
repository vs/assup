import { describe, it, expect } from "vitest";
import { fundamentalsAnalyzer } from "../../../services/research/analyzers/fundamentals.analyzer.js";

describe("fundamentalsAnalyzer", () => {
  it("has correct source", () => {
    expect(fundamentalsAnalyzer.source).toBe("fundamentals");
  });

  it("scores shortable data when available", async () => {
    const result = await fundamentalsAnalyzer.analyze({
      fundamentals: {
        pe: null, forwardPe: null, eps: null, epsGrowth: null,
        dividendYield: null, revenue: null, marketCap: null, beta: null,
        roe: null, debtToEquity: null, profitMargin: null, revenueGrowth: null,
        bookValue: null, priceToBook: null, priceToCashFlow: null,
      },
      volatility: { historical30d: null, implied: null },
      optionActivity: {
        callVolume: null, putVolume: null,
        callOI: null, putOI: null, putCallRatio: null,
      },
      shortable: { isShortable: true, sharesAvailable: 500000 },
    });

    expect(result.signal).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0.1);
    expect(result.summary).toContain("500,000");
  });

  it("signals hard-to-borrow when shares available is very low", async () => {
    const result = await fundamentalsAnalyzer.analyze({
      fundamentals: {
        pe: null, forwardPe: null, eps: null, epsGrowth: null,
        dividendYield: null, revenue: null, marketCap: null, beta: null,
        roe: null, debtToEquity: null, profitMargin: null, revenueGrowth: null,
        bookValue: null, priceToBook: null, priceToCashFlow: null,
      },
      volatility: { historical30d: null, implied: null },
      optionActivity: {
        callVolume: null, putVolume: null,
        callOI: null, putOI: null, putCallRatio: null,
      },
      shortable: { isShortable: false, sharesAvailable: 50000 },
    });

    expect(result.summary).toContain("Hard to borrow");
  });

  it("returns volatility-based analysis when valuation ratios are all null", async () => {
    const result = await fundamentalsAnalyzer.analyze({
      fundamentals: {
        pe: null, forwardPe: null, eps: null, epsGrowth: null,
        dividendYield: null, revenue: null, marketCap: null, beta: null,
        roe: null, debtToEquity: null, profitMargin: null, revenueGrowth: null,
        bookValue: null, priceToBook: null, priceToCashFlow: null,
      },
      volatility: { historical30d: 0.35, implied: 0.50 },
      optionActivity: {
        callVolume: 1000, putVolume: 500,
        callOI: null, putOI: null, putCallRatio: 0.5,
      },
      shortable: { isShortable: true, sharesAvailable: 200000 },
    });

    expect(result.confidence).toBeGreaterThan(0.1);
    expect(result.summary).not.toContain("Insufficient fundamental data");
    expect(result.summary).toContain("IV");
  });

  it("returns insufficient data when nothing is available", async () => {
    const result = await fundamentalsAnalyzer.analyze({
      fundamentals: {
        pe: null, forwardPe: null, eps: null, epsGrowth: null,
        dividendYield: null, revenue: null, marketCap: null, beta: null,
        roe: null, debtToEquity: null, profitMargin: null, revenueGrowth: null,
        bookValue: null, priceToBook: null, priceToCashFlow: null,
      },
      volatility: { historical30d: null, implied: null },
      optionActivity: {
        callVolume: null, putVolume: null,
        callOI: null, putOI: null, putCallRatio: null,
      },
      shortable: { isShortable: null, sharesAvailable: null },
    });

    expect(result.confidence).toBe(0.1);
    expect(result.summary).toContain("Insufficient");
  });

  it("scores valuation ratios correctly when available", async () => {
    const result = await fundamentalsAnalyzer.analyze({
      fundamentals: {
        pe: 12, forwardPe: null, eps: 3.5, epsGrowth: 25,
        dividendYield: null, revenue: null, marketCap: null, beta: null,
        roe: 22, debtToEquity: 40, profitMargin: 25, revenueGrowth: 18,
        bookValue: null, priceToBook: null, priceToCashFlow: null,
      },
      volatility: { historical30d: null, implied: null },
      optionActivity: {
        callVolume: null, putVolume: null,
        callOI: null, putOI: null, putCallRatio: null,
      },
      shortable: { isShortable: null, sharesAvailable: null },
    });

    expect(result.signal).toBe("bullish");
    expect(result.confidence).toBeGreaterThan(0.3);
  });
});
