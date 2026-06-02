import { describe, it, expect } from "vitest";
import { analyzeSpread, cdf, probabilityITM } from "../../services/spreadAnalysis.js";
import type { IronCondorAnalyzeRequest } from "@assup/shared";

describe("cdf", () => {
  it("returns 0.5 for x=0", () => {
    expect(cdf(0)).toBeCloseTo(0.5, 4);
  });
  it("returns ~0.8413 for x=1", () => {
    expect(cdf(1)).toBeCloseTo(0.8413, 3);
  });
  it("returns ~0.0228 for x=-2", () => {
    expect(cdf(-2)).toBeCloseTo(0.0228, 3);
  });
});

describe("probabilityITM", () => {
  it("calculates put probability", () => {
    const prob = probabilityITM(5500, 5400, 18, 7, "PUT");
    expect(prob).toBeGreaterThan(0);
    expect(prob).toBeLessThan(1);
  });
  it("calculates call probability", () => {
    const prob = probabilityITM(5500, 5600, 18, 7, "CALL");
    expect(prob).toBeGreaterThan(0);
    expect(prob).toBeLessThan(1);
  });
  it("ATM put has ~50% probability", () => {
    const prob = probabilityITM(5500, 5500, 20, 30, "PUT");
    expect(prob).toBeCloseTo(0.5, 1);
  });
});

describe("analyzeSpread", () => {
  it("analyzes a put spread correctly", () => {
    const req: IronCondorAnalyzeRequest = {
      underlyingPrice: 5500,
      legs: [
        { strike: 5400, type: "PUT", side: "SELL", iv: 18, bid: 8.0, ask: 9.0 },
        { strike: 5350, type: "PUT", side: "BUY", iv: 19, bid: 5.0, ask: 6.0 },
      ],
      daysToExpiry: 7, quantity: 1, mode: "put-spread",
    };
    const result = analyzeSpread(req);
    expect(result.netCredit.mid).toBeGreaterThan(0);
    expect(result.maxProfit).toBeGreaterThan(0);
    expect(result.maxLossPut).not.toBeNull();
    expect(result.maxLossCall).toBeNull();
    expect(result.breakEvenLow).not.toBeNull();
    expect(result.breakEvenHigh).toBeNull();
    expect(result.probabilityOfProfit).toBeGreaterThan(0);
    expect(result.probabilityOfProfit).toBeLessThan(1);
    expect(result.payoffCurve.length).toBe(100);
    expect(result.riskRewardRatio).toBeGreaterThan(0);
  });

  it("analyzes a call spread correctly", () => {
    const req: IronCondorAnalyzeRequest = {
      underlyingPrice: 5500,
      legs: [
        { strike: 5600, type: "CALL", side: "SELL", iv: 17, bid: 7.0, ask: 8.0 },
        { strike: 5650, type: "CALL", side: "BUY", iv: 16, bid: 4.0, ask: 5.0 },
      ],
      daysToExpiry: 7, quantity: 1, mode: "call-spread",
    };
    const result = analyzeSpread(req);
    expect(result.netCredit.mid).toBeGreaterThan(0);
    expect(result.maxLossPut).toBeNull();
    expect(result.maxLossCall).not.toBeNull();
    expect(result.breakEvenLow).toBeNull();
    expect(result.breakEvenHigh).not.toBeNull();
  });

  it("analyzes an iron condor correctly", () => {
    const req: IronCondorAnalyzeRequest = {
      underlyingPrice: 5500,
      legs: [
        { strike: 5400, type: "PUT", side: "SELL", iv: 18, bid: 8.0, ask: 9.0 },
        { strike: 5350, type: "PUT", side: "BUY", iv: 19, bid: 5.0, ask: 6.0 },
        { strike: 5600, type: "CALL", side: "SELL", iv: 17, bid: 7.0, ask: 8.0 },
        { strike: 5650, type: "CALL", side: "BUY", iv: 16, bid: 4.0, ask: 5.0 },
      ],
      daysToExpiry: 7, quantity: 1, mode: "iron-condor",
    };
    const result = analyzeSpread(req);
    expect(result.netCredit.mid).toBeGreaterThan(0);
    expect(result.maxLossPut).not.toBeNull();
    expect(result.maxLossCall).not.toBeNull();
    expect(result.breakEvenLow).not.toBeNull();
    expect(result.breakEvenHigh).not.toBeNull();
    expect(result.payoffCurve.length).toBe(100);
  });

  it("net credit uses conservative pricing (sell at bid, buy at ask)", () => {
    const req: IronCondorAnalyzeRequest = {
      underlyingPrice: 5500,
      legs: [
        { strike: 5400, type: "PUT", side: "SELL", iv: 18, bid: 8.0, ask: 9.0 },
        { strike: 5350, type: "PUT", side: "BUY", iv: 19, bid: 5.0, ask: 6.0 },
      ],
      daysToExpiry: 7, quantity: 1, mode: "put-spread",
    };
    const result = analyzeSpread(req);
    expect(result.netCredit.bid).toBeCloseTo(2.0, 1);
    expect(result.netCredit.ask).toBeCloseTo(4.0, 1);
  });
});
