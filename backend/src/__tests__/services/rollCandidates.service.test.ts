/**
 * Tests for Roll Candidates Service pure helpers
 */

import { describe, it, expect } from "vitest";
import {
  filterCandidateEntries,
  computeNetCredits,
  computeRollAnnualizedReturn,
} from "../../services/rollCandidates.service.js";
import type { OptionChainEntry } from "../../services/ibkr.js";

function makeEntry(strike: number, expiration: string): OptionChainEntry {
  const base = {
    symbol: "QZJO",
    secType: "OPT" as const,
    strike,
    lastTradeDateOrContractMonth: expiration,
    multiplier: 100,
    currency: "USD",
  };
  return {
    strike,
    expiration,
    call: { ...base, right: "C" },
    put: { ...base, right: "P" },
  };
}

describe("filterCandidateEntries", () => {
  const chain: OptionChainEntry[] = [
    makeEntry(185, "20250117"), // same strike, same expiry — excluded
    makeEntry(190, "20250117"), // higher strike, same expiry — too soon (0 days beyond)
    makeEntry(190, "20250221"), // higher strike, 35 days after Jan 17 — included
    makeEntry(192, "20250221"), // higher strike, 35 days after Jan 17 — included
    makeEntry(180, "20250221"), // lower strike — excluded (call direction)
    makeEntry(190, "20250214"), // higher strike, 28 days after Jan 17 — below minDTEBeyond=30
  ];

  it("returns only entries with higher strike and sufficient DTE beyond for calls", () => {
    const result = filterCandidateEntries(chain, 185, "20250117", "C", 30);
    expect(result.map((e) => `${e.strike}-${e.expiration}`)).toEqual([
      "190-20250221",
      "192-20250221",
    ]);
  });

  it("returns only entries with lower strike and sufficient DTE beyond for puts", () => {
    const putChain: OptionChainEntry[] = [
      makeEntry(185, "20250117"), // same strike, same expiry — excluded
      makeEntry(180, "20250221"), // lower strike, 35 days — included
      makeEntry(175, "20250221"), // lower strike, 35 days — included
      makeEntry(190, "20250221"), // higher strike — excluded for put direction
    ];
    const result = filterCandidateEntries(putChain, 185, "20250117", "P", 30);
    expect(result.map((e) => `${e.strike}-${e.expiration}`)).toEqual([
      "180-20250221",
      "175-20250221",
    ]);
  });

  it("excludes entries with exactly boundary DTE (28 days < 30 days)", () => {
    const result = filterCandidateEntries(chain, 185, "20250117", "C", 30);
    expect(result.find((e) => e.expiration === "20250214")).toBeUndefined();
  });
});

describe("computeNetCredits", () => {
  it("computes conservative and mid net credits correctly", () => {
    // candidateBid=8.00, candidateAsk=8.50 → candidateMid=8.25
    // closeBid=7.00, closeAsk=7.50 → closeMid=7.25
    const result = computeNetCredits(8.00, 8.50, 7.50, 7.00);
    expect(result.netCredit).toBeCloseTo(0.50);    // 8.00 - 7.50
    expect(result.netCreditMid).toBeCloseTo(1.00); // 8.25 - 7.25
  });

  it("returns negative credits when close cost exceeds new premium", () => {
    const result = computeNetCredits(3.00, 3.50, 8.50, 8.00);
    expect(result.netCredit).toBeCloseTo(-5.50);   // 3.00 - 8.50
    expect(result.netCreditMid).toBeCloseTo(-5.00); // 3.25 - 8.25
  });
});

describe("computeRollAnnualizedReturn", () => {
  it("computes annualized return from net credit mid, strike, and DTE", () => {
    // (1.00 / 190) * (365 / 38) * 100 ≈ 5.06%
    const result = computeRollAnnualizedReturn(1.00, 190, 38);
    expect(result).toBeCloseTo(5.06, 1);
  });

  it("returns 0 when DTE is 0", () => {
    expect(computeRollAnnualizedReturn(1.00, 190, 0)).toBe(0);
  });
});
