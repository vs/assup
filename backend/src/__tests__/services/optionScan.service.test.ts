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
