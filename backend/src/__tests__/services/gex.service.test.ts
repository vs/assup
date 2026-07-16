import { describe, it, expect } from "vitest";
import {
  bsGamma,
  calcStrikeGEX,
  findKeyLevels,
  calcSummary,
} from "../../services/gex.service.js";
import type { GexStrikeData } from "@assup/shared";

describe("bsGamma", () => {
  it("returns positive gamma for ATM option", () => {
    const gamma = bsGamma(5500, 5500, 0.20, 7 / 365, 0.05);
    expect(gamma).toBeGreaterThan(0);
  });

  it("ATM gamma is higher than OTM gamma", () => {
    const T = 7 / 365;
    const atmGamma = bsGamma(5500, 5500, 0.20, T, 0.05);
    const otmGamma = bsGamma(5500, 5300, 0.20, T, 0.05);
    expect(atmGamma).toBeGreaterThan(otmGamma);
  });

  it("returns 0 for invalid inputs", () => {
    expect(bsGamma(0, 5500, 0.20, 7 / 365, 0.05)).toBe(0);
    expect(bsGamma(5500, 0, 0.20, 7 / 365, 0.05)).toBe(0);
    expect(bsGamma(5500, 5500, 0, 7 / 365, 0.05)).toBe(0);
    expect(bsGamma(5500, 5500, 0.20, 0, 0.05)).toBe(0);
  });

  it("shorter DTE produces higher gamma (all else equal)", () => {
    const short = bsGamma(5500, 5500, 0.20, 1 / 365, 0.05);
    const long = bsGamma(5500, 5500, 0.20, 30 / 365, 0.05);
    expect(short).toBeGreaterThan(long);
  });
});

describe("calcStrikeGEX", () => {
  it("calls contribute positive GEX, puts contribute negative GEX", () => {
    const spot = 5500;
    const T = 7 / 365;
    const result = calcStrikeGEX({
      spot,
      strike: 5500,
      callOI: 1000,
      putOI: 1000,
      callIV: 0.20,
      putIV: 0.20,
      callVolume: 500,
      putVolume: 500,
      T,
      riskFreeRate: 0.05,
    });

    expect(result.callGEX).toBeGreaterThan(0);
    expect(result.putGEX).toBeLessThan(0);
  });

  it("zero OI produces zero GEX", () => {
    const result = calcStrikeGEX({
      spot: 5500,
      strike: 5500,
      callOI: 0,
      putOI: 0,
      callIV: 0.20,
      putIV: 0.20,
      callVolume: 0,
      putVolume: 0,
      T: 7 / 365,
      riskFreeRate: 0.05,
    });

    expect(result.callGEX).toBe(0);
    expect(result.putGEX).toBe(0);
    expect(result.netGEX).toBe(0);
  });
});

describe("findKeyLevels", () => {
  const strikes: GexStrikeData[] = [];
  for (let s = 5400; s <= 5600; s += 10) {
    const distFromPutPeak = Math.abs(s - 5450);
    const distFromCallPeak = Math.abs(s - 5550);
    const putOI = Math.max(0, 5000 - distFromPutPeak * 30);
    const callOI = Math.max(0, 5000 - distFromCallPeak * 30);
    const netGEX = (s - 5500) * 10;
    strikes.push({
      strike: s,
      callOI,
      putOI,
      callVolume: 0,
      putVolume: 0,
      callGEX: Math.max(0, netGEX),
      putGEX: Math.min(0, netGEX - Math.max(0, netGEX)),
      netGEX,
    });
  }

  it("identifies the put wall correctly", () => {
    const levels = findKeyLevels(strikes, 5500);
    expect(levels.putWall.strike).toBe(5450);
  });

  it("identifies the call wall correctly", () => {
    const levels = findKeyLevels(strikes, 5500);
    expect(levels.callWall.strike).toBe(5550);
  });

  it("finds GEX flip point between negative and positive transition", () => {
    const levels = findKeyLevels(strikes, 5500);
    expect(levels.gexFlip).not.toBeNull();
    expect(levels.gexFlip!).toBeGreaterThanOrEqual(5490);
    expect(levels.gexFlip!).toBeLessThanOrEqual(5510);
  });

  it("returns null GEX flip when all GEX is same sign", () => {
    const allPositive = strikes.map(s => ({ ...s, netGEX: Math.abs(s.netGEX) + 1 }));
    const levels = findKeyLevels(allPositive, 5500);
    expect(levels.gexFlip).toBeNull();
  });
});

describe("calcSummary", () => {
  it("calculates put/call ratio correctly", () => {
    const strikes: GexStrikeData[] = [
      { strike: 5400, callOI: 1000, putOI: 2000, callVolume: 0, putVolume: 0, callGEX: 100, putGEX: -200, netGEX: -100 },
      { strike: 5500, callOI: 3000, putOI: 1000, callVolume: 0, putVolume: 0, callGEX: 300, putGEX: -100, netGEX: 200 },
    ];
    const summary = calcSummary(strikes, 5450);
    expect(summary.totalPutOI).toBe(3000);
    expect(summary.totalCallOI).toBe(4000);
    expect(summary.putCallRatio).toBeCloseTo(0.75, 2);
  });

  it("determines regime based on GEX at nearest strike to spot", () => {
    const strikes: GexStrikeData[] = [
      { strike: 5400, callOI: 0, putOI: 0, callVolume: 0, putVolume: 0, callGEX: 0, putGEX: -500, netGEX: -500 },
      { strike: 5500, callOI: 0, putOI: 0, callVolume: 0, putVolume: 0, callGEX: 300, putGEX: -100, netGEX: 200 },
    ];
    const summary = calcSummary(strikes, 5500);
    expect(summary.netGEXRegime).toBe("positive");

    const summary2 = calcSummary(strikes, 5400);
    expect(summary2.netGEXRegime).toBe("negative");
  });
});
