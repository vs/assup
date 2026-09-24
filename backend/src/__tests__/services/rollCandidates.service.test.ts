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
  // A roll can go to any strike: rolling a short put out at the same or a higher
  // strike pays more premium (at more risk), so the scan spans a band around the
  // current strike in both directions rather than one "safer" direction.
  const chain: OptionChainEntry[] = [
    makeEntry(185, "20250117"), // same strike, same expiry — too soon
    makeEntry(190, "20250117"), // same expiry — too soon (0 days beyond)
    makeEntry(185, "20250221"), // same strike, 35 days after Jan 17 — included
    makeEntry(190, "20250221"), // higher strike — included
    makeEntry(180, "20250221"), // lower strike — included
    makeEntry(190, "20250214"), // 28 days after Jan 17 — below minDTEBeyond=30
  ];

  it("includes strikes on both sides of the current one, and the same strike", () => {
    const result = filterCandidateEntries(chain, 185, "20250117", "C", 30, 20);
    expect(result.map((e) => `${e.strike}-${e.expiration}`).sort()).toEqual([
      "180-20250221",
      "185-20250221",
      "190-20250221",
    ]);
  });

  it("applies the same band to puts (a same-strike roll-out is the classic roll)", () => {
    const result = filterCandidateEntries(chain, 185, "20250117", "P", 30, 20);
    expect(result.map((e) => e.strike).sort((x, y) => x - y)).toEqual([180, 185, 190]);
  });

  it("limits strikes to the band around the current strike", () => {
    const wide: OptionChainEntry[] = [
      makeEntry(140, "20250221"), // 75.7% of 185 — outside ±20%
      makeEntry(150, "20250221"), // 81.1% — inside
      makeEntry(220, "20250221"), // 118.9% — inside
      makeEntry(230, "20250221"), // 124.3% — outside
    ];
    const result = filterCandidateEntries(wide, 185, "20250117", "P", 30, 20);
    expect(result.map((e) => e.strike).sort((x, y) => x - y)).toEqual([150, 220]);
  });

  it("excludes entries with exactly boundary DTE (28 days < 30 days)", () => {
    const result = filterCandidateEntries(chain, 185, "20250117", "C", 30, 20);
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
