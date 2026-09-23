/**
 * Tests for the shared option scan service.
 *
 * Regression cover for the "silent zero" failure mode: when TWS fails to answer
 * a contract-details request, the scan used to report the symbol as a perfectly
 * good 0-opportunity result, making an infrastructure outage look like
 * "no options matched your criteria".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getOptionChain = vi.fn();
const quoteGet = vi.fn();

vi.mock("../../services/ibkr.js", () => ({
  ibkrService: {
    getOptionChain: (...args: unknown[]) => getOptionChain(...args),
  },
}));

vi.mock("../../services/quotes/index.js", async () => {
  const keys = await vi.importActual<typeof import("../../services/quotes/quoteKey.js")>("../../services/quotes/quoteKey.js");
  return {
    quoteHub: { get: (...args: unknown[]) => quoteGet(...args) },
    quoteKey: keys.quoteKey,
    quotePrice: keys.quotePrice,
    summarizeStatuses: keys.summarizeStatuses,
  };
});

vi.mock("../../utils/options.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/options.js")>();
  return {
    ...actual,
    getUnderlyingPrice: async () => 100,
  };
});

const { scanSymbols } = await import("../../services/optionScan.service.js");
const { quoteKey } = await import("../../services/quotes/quoteKey.js");
import type { ScannerCriteria } from "@assup/shared";
import type { Quote, QuoteContract } from "../../services/quotes/quoteTypes.js";

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

/** Answer quoteHub.get: `quotesByStrike` values for listed strikes, `fallback` status for the rest. */
function quoteContracts(
  quotesByStrike: Record<number, Partial<Quote>>,
  fallback: Partial<Quote> = { status: "timeout" },
) {
  quoteGet.mockImplementation(async (contracts: QuoteContract[]) =>
    new Map(contracts.map((c) => {
      const key = quoteKey(c);
      const q = quotesByStrike[c.strike!] ?? fallback;
      return [key, { key, updatedAt: 1, status: "ok", ...q } as Quote];
    })),
  );
}

beforeEach(() => {
  getOptionChain.mockReset();
  quoteGet.mockReset();
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
    // The chain resolves fine, but no quote arrives for any contract
    // (market closed / TWS saturated), so the scan sees no quotes.
    getOptionChain.mockResolvedValue([futureChainEntry(90), futureChainEntry(85)]);
    quoteContracts({});

    const result = await scanSymbols({
      symbolAssignments,
      criteria,
      callbacks: { onSymbolComplete: () => {} },
    });

    expect(result.opportunities).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].symbol).toBe("QZAC");
    expect(result.failures[0].error).toMatch(/no market data/i);
    expect(result.failures[0].error).toContain("2 timeout");
  });

  it("does not report a failure when quotes arrive but nothing meets the criteria", async () => {
    getOptionChain.mockResolvedValue([futureChainEntry(90)]);
    quoteContracts({ 90: { bid: 1, ask: 1.1 } });

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

describe("scanSymbols — quoting", () => {
  // ZAG scans failed with 0/350 quotes: option snapshots take ~11s in TWS, but
  // the batch gave up after 2s (then 5s on retry). The QuoteHub streams instead.
  it("quotes the filtered contracts with bid, ask and delta through the QuoteHub", async () => {
    getOptionChain.mockResolvedValue([futureChainEntry(90), futureChainEntry(85)]);
    quoteContracts({ 90: { bid: 1, ask: 1.1, delta: -0.3 } }, { status: "no-contract", error: "No security definition" });

    const result = await scanSymbols({
      symbolAssignments,
      criteria,
      callbacks: { onSymbolComplete: () => {} },
    });

    const [contracts, opts] = quoteGet.mock.calls[0];
    expect((contracts as QuoteContract[]).map((c) => c.strike).sort()).toEqual([85, 90]);
    expect(opts).toMatchObject({ fields: ["bid", "ask", "delta"] });
    expect(result.failures).toEqual([]);
    expect(result.opportunities.map((o) => o.strike)).toEqual([90]);
  });

  // Since 70e667e the scan only had bid/ask, so every delta filter used the
  // linear estimate and the Delta column was empty.
  it("filters and reports with the TWS delta, not the estimate", async () => {
    getOptionChain.mockResolvedValue([futureChainEntry(90), futureChainEntry(85)]);
    // The linear estimate would put both strikes inside 0.2-0.5
    quoteContracts({ 90: { bid: 1, ask: 1.1, delta: -0.35 }, 85: { bid: 0.5, ask: 0.6, delta: -0.12 } });

    const result = await scanSymbols({
      symbolAssignments,
      criteria: { ...criteria, minDelta: 0.2, maxDelta: 0.5 },
      callbacks: { onSymbolComplete: () => {} },
    });

    expect(result.opportunities.map((o) => [o.strike, o.delta])).toEqual([[90, -0.35]]);
  });

  it("uses bid/ask from a quote whose delta timed out, estimating delta", async () => {
    getOptionChain.mockResolvedValue([futureChainEntry(90)]);
    quoteContracts({ 90: { status: "timeout", bid: 1, ask: 1.1 } });

    const result = await scanSymbols({ symbolAssignments, criteria, callbacks: { onSymbolComplete: () => {} } });

    expect(result.failures).toEqual([]);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0].delta).toBeUndefined();
  });

  it("fails the symbol loudly with the QuoteHub reason when no lines are available", async () => {
    getOptionChain.mockResolvedValue([futureChainEntry(90)]);
    quoteContracts({}, {
      status: "no-lines",
      error: "No market data line available: 100/100 market data lines are in use",
    });

    const result = await scanSymbols({ symbolAssignments, criteria, callbacks: { onSymbolComplete: () => {} } });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].error).toMatch(/1 no-lines/);
    expect(result.failures[0].error).toMatch(/market data lines are in use/);
  });
});
