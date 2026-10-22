import { describe, it, expect } from "vitest";
import {
  bsGamma,
  calcStrikeGEX,
  findKeyLevels,
  calcSummary,
  marketCloseMs,
  yearsToExpiry,
  etDateString,
  findZeroCrossing,
  buildGexProfile,
  resolveIV,
  type GexContract,
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

describe("expiry timing", () => {
  it("market close is 16:00 EDT in summer and 16:00 EST in winter", () => {
    expect(new Date(marketCloseMs("2026-07-15")).toISOString()).toBe("2026-07-15T20:00:00.000Z");
    expect(new Date(marketCloseMs("2026-12-15")).toISOString()).toBe("2026-12-15T21:00:00.000Z");
  });

  it("0DTE in the morning has ~6.5 hours left, not the floor", () => {
    const now = Date.parse("2026-10-22T13:30:00Z"); // 9:30 ET
    const T = yearsToExpiry("2026-10-22", now);
    expect(T * 365 * 24).toBeCloseTo(6.5, 5);
  });

  it("returns 0 after the close and floors at one hour before it", () => {
    expect(yearsToExpiry("2026-10-22", Date.parse("2026-10-22T20:00:01Z"))).toBe(0);
    expect(yearsToExpiry("2026-10-22", Date.parse("2026-10-22T19:59:00Z"))).toBeCloseTo(1 / (365 * 24), 10);
  });

  it("uses the New York calendar date", () => {
    expect(etDateString(Date.parse("2026-10-23T02:00:00Z"))).toBe("2026-10-22");
  });
});

describe("findZeroCrossing", () => {
  it("interpolates the crossing nearest to spot", () => {
    const xs = [90, 100, 110, 120, 130];
    const ys = [-2, -1, 1, -1, -3];
    expect(findZeroCrossing(xs, ys, 104)).toBe(105);
    expect(findZeroCrossing(xs, ys, 118)).toBe(115);
  });

  it("returns null when the series never changes sign", () => {
    expect(findZeroCrossing([1, 2, 3], [1, 2, 3], 2)).toBeNull();
  });
});

describe("buildGexProfile", () => {
  const T7 = 7 / 365;
  const T0 = 3 / (365 * 24);
  const contracts: GexContract[] = [
    { strike: 95, openInterest: 1000, iv: 0.2, T: T7, isCall: false, zeroDte: false },
    { strike: 105, openInterest: 1000, iv: 0.2, T: T7, isCall: true, zeroDte: false },
    { strike: 100, openInterest: 500, iv: 0.2, T: T0, isCall: false, zeroDte: true },
  ];

  it("splits net GEX at spot into 0DTE and ex-0DTE", () => {
    const p = buildGexProfile(contracts, 100, 0.1, 40);
    expect(p.netAtSpot.zeroDte).toBeLessThan(0);
    expect(p.netAtSpot.all).toBeCloseTo(p.netAtSpot.exZeroDte + p.netAtSpot.zeroDte, 6);
    expect(p.largestZeroDteStrike).toBe(100);
    const s100 = p.strikes.find((s) => s.strike === 100)!;
    expect(s100.netGEX).toBe(s100.zeroDteGEX);
  });

  it("finds a flip between the put and call strikes, shifted up by 0DTE puts", () => {
    const p = buildGexProfile(contracts, 100, 0.1, 200);
    expect(p.flip.exZeroDte).not.toBeNull();
    expect(p.flip.all).not.toBeNull();
    expect(p.flip.exZeroDte!).toBeGreaterThan(95);
    expect(p.flip.exZeroDte!).toBeLessThan(105);
    expect(p.flip.all!).toBeGreaterThan(p.flip.exZeroDte!);
    expect(p.profile).toHaveLength(201);
    expect(p.profile[0].price).toBeCloseTo(90);
    expect(p.profile[200].price).toBeCloseTo(110);
  });

  it("ignores expired, zero-OI and zero-IV contracts", () => {
    const p = buildGexProfile(
      [
        { strike: 100, openInterest: 1000, iv: 0.2, T: 0, isCall: true, zeroDte: true },
        { strike: 100, openInterest: 0, iv: 0.2, T: T7, isCall: true, zeroDte: false },
        { strike: 100, openInterest: 1000, iv: 0, T: T7, isCall: true, zeroDte: false },
      ],
      100, 0.1, 10,
    );
    expect(p.strikes).toHaveLength(0);
    expect(p.netAtSpot.all).toBe(0);
    expect(p.largestZeroDteStrike).toBeNull();
  });
});

describe("resolveIV", () => {
  it("keeps a usable IV", () => {
    expect(resolveIV(0.18, 0.2)).toBe(0.18);
  });

  it("replaces Yahoo's 0.00001 placeholder with the opposite side via put-call parity", () => {
    expect(resolveIV(0.00001, 0.21)).toBe(0.21);
  });

  it("returns 0 when neither side is usable", () => {
    expect(resolveIV(0.00001, 0)).toBe(0);
    expect(resolveIV(NaN, 0.00001)).toBe(0);
  });
});
