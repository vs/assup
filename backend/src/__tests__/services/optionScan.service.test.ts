/**
 * Tests for the shared option scan service.
 *
 * Regression cover for the "silent zero" failure mode: when TWS fails to answer
 * a contract-details request, the scan used to report the symbol as a perfectly
 * good 0-opportunity result, making an infrastructure outage look like
 * "no options matched your criteria".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getOptionChain = vi.fn();
const getMarketDataBatch = vi.fn();

vi.mock("../../services/ibkr.js", () => ({
  ibkrService: {
    getOptionChain: (...args: unknown[]) => getOptionChain(...args),
    getMarketDataBatch: (...args: unknown[]) => getMarketDataBatch(...args),
  },
}));

vi.mock("../../utils/options.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/options.js")>();
  return {
    ...actual,
    // Bypass the IBKR live-market-data ref counting in tests.
    withLiveMarketData: async (fn: () => Promise<void>) => fn(),
    getUnderlyingPrice: async () => 100,
  };
});

const { scanSymbols } = await import("../../services/optionScan.service.js");
import type { ScannerCriteria } from "@assup/shared";

const criteria: ScannerCriteria = {
  optionTypes: "PUT",
  minDaysToExpiry: 1,
  maxDaysToExpiry: 90,
  minDelta: 0,
  maxDelta: 1,
  minAnnualizedReturn: 0,
  minPremiumPercent: 0,
  putMinStrikePercent: 75,
  putMaxStrikePercent: 100,
  callMinStrikePercent: 100,
  callMaxStrikePercent: 125,
};

const symbolAssignments = new Map([["QZAC", { name: "Stocks: Tech", color: "#fff" }]]);

/** A chain entry ~30 days out at a strike inside the PUT range (underlying is mocked to 100). */
function futureChainEntry(strike: number) {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  const expiration = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const base = { symbol: "QZAC", secType: "OPT", strike, lastTradeDateOrContractMonth: expiration, multiplier: 100, currency: "USD" };
  return { strike, expiration, call: { ...base, right: "C" }, put: { ...base, right: "P" } };
}

beforeEach(() => {
  getOptionChain.mockReset();
  getMarketDataBatch.mockReset();
});

describe("scanSymbols — TWS failures must not masquerade as zero results", () => {
  it("reports a symbol as failed when the option chain lookup throws", async () => {
    getOptionChain.mockRejectedValue(
      new Error("getContractDetails timed out after 30000ms for QZAC"),
    );

    const completed: Array<{ symbol: string; count: number }> = [];
    const result = await scanSymbols({
      symbolAssignments,
      criteria,
      callbacks: {
        onSymbolComplete: (symbol, _ac, opps) =>
          void completed.push({ symbol, count: opps.length }),
      },
    });

    expect(result.failures).toEqual([
      { symbol: "QZAC", error: "getContractDetails timed out after 30000ms for QZAC" },
    ]);
    expect(result.opportunities).toHaveLength(0);
    expect(completed).toEqual([{ symbol: "QZAC", count: 0 }]);
  });

  it("reports a failure when no contract returned market data", async () => {
    // The real-world case: the chain resolves fine, but every snapshot request
    // times out (market closed / TWS saturated), so the scan sees no quotes.
    getOptionChain.mockResolvedValue([futureChainEntry(90), futureChainEntry(85)]);
    getMarketDataBatch.mockResolvedValue(new Map());

    const result = await scanSymbols({
      symbolAssignments,
      criteria,
      callbacks: { onSymbolComplete: () => {} },
    });

    expect(result.opportunities).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].symbol).toBe("QZAC");
    expect(result.failures[0].error).toMatch(/no market data/i);
    expect(result.failures[0].error).toContain("2");
  });

  it("does not report a failure when quotes arrive but nothing meets the criteria", async () => {
    getOptionChain.mockResolvedValue([futureChainEntry(90)]);
    getMarketDataBatch.mockResolvedValue(
      new Map([["NBIS_" + futureChainEntry(90).expiration + "_90_P", { bid: 1, ask: 1.1 }]]),
    );

    const result = await scanSymbols({
      symbolAssignments,
      // Impossible return floor — a genuine "nothing matched" result.
      criteria: { ...criteria, minAnnualizedReturn: 100000 },
      callbacks: { onSymbolComplete: () => {} },
    });

    expect(result.opportunities).toHaveLength(0);
    expect(result.failures).toEqual([]);
  });

  it("reports no failures when a symbol genuinely has no options listed", async () => {
    getOptionChain.mockResolvedValue([]);

    const result = await scanSymbols({
      symbolAssignments,
      criteria,
      callbacks: { onSymbolComplete: () => {} },
    });

    expect(result.failures).toEqual([]);
    expect(result.opportunities).toHaveLength(0);
  });
});
