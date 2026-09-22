/**
 * Tests for the findRollCandidates IBKR flow.
 *
 * Regression cover for ZAG roll scans never returning: the scan requested
 * quotes for every strike in the union chain (half of which are not listed
 * for a given expiry) through serial 2s snapshots, blowing the client's 90s
 * timeout, while parallel contract-details lookups timed out and silently
 * left every candidate with conId 0.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Contract } from "@stoqey/ib";

const getMarketData = vi.fn();
const getOptionChain = vi.fn();
const getOptionContracts = vi.fn();
const getOptionQuotes = vi.fn();

vi.mock("../../services/ibkr.js", () => ({
  ibkrService: {
    getMarketData: (...args: unknown[]) => getMarketData(...args),
    getOptionChain: (...args: unknown[]) => getOptionChain(...args),
    getOptionContracts: (...args: unknown[]) => getOptionContracts(...args),
    getOptionQuotes: (...args: unknown[]) => getOptionQuotes(...args),
  },
}));

vi.mock("../../utils/options.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/options.js")>();
  return {
    ...actual,
    withLiveMarketData: async (fn: () => Promise<void>) => fn(),
  };
});

const { findRollCandidates } = await import("../../services/rollCandidates.service.js");
const { marketDataLineRegistry } = await import("../../services/marketDataLineRegistry.js");

function chainEntry(strike: number, expiration: string) {
  const base = {
    symbol: "ZAG",
    secType: "OPT",
    exchange: "SMART",
    currency: "USD",
    strike,
    lastTradeDateOrContractMonth: expiration,
    multiplier: 100,
    tradingClass: "ZAG",
  };
  return { strike, expiration, call: { ...base, right: "C" }, put: { ...base, right: "P" } };
}

function listed(strike: number, expiration: string, conId: number): Contract {
  return {
    symbol: "ZAG",
    secType: "OPT" as Contract["secType"],
    exchange: "SMART",
    currency: "USD",
    strike,
    lastTradeDateOrContractMonth: expiration,
    right: "C" as Contract["right"],
    multiplier: 100,
    tradingClass: "ZAG",
    conId,
  };
}

const request = {
  symbol: "ZAG",
  expiration: "20260918",
  strike: 57,
  right: "C" as const,
  conId: 111,
  minDTEBeyond: 30,
};

describe("findRollCandidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMarketData.mockResolvedValue({ bid: 1.0, ask: 1.2 });
    // Union chain: 58/59/60 in both expiries, but 59 is only listed in October.
    getOptionChain.mockResolvedValue([
      chainEntry(58, "20261023"),
      chainEntry(59, "20261023"),
      chainEntry(60, "20261023"),
      chainEntry(58, "20261120"),
      chainEntry(59, "20261120"),
      chainEntry(60, "20261120"),
    ]);
    getOptionContracts.mockImplementation(async (_s: string, expiry: string) =>
      expiry === "20261023"
        ? [listed(56, expiry, 1), listed(58, expiry, 2), listed(59, expiry, 3), listed(60, expiry, 4)]
        : [listed(58, expiry, 5), listed(60, expiry, 6)],
    );
  });

  afterEach(() => {
    marketDataLineRegistry.release("test-hog");
  });

  it("quotes only listed contracts and returns their real conIds", async () => {
    getOptionQuotes.mockImplementation(async (contracts: Contract[]) =>
      new Map(contracts.map((c) => [`SLV_${c.lastTradeDateOrContractMonth}_${c.strike}_C`, { bid: 2.0, ask: 2.2 }])),
    );

    const result = await findRollCandidates(request);

    const quoted = (getOptionQuotes.mock.calls[0][0] as Contract[]).map((c) => c.conId);
    expect(quoted.sort()).toEqual([2, 3, 4, 5, 6]); // strike 56 is below the current call strike
    expect(getOptionContracts).toHaveBeenCalledWith("ZAG", "20261023", "ZAG", 100, "C");
    expect(result.candidates.map((c) => c.conId).sort()).toEqual([2, 3, 4, 5, 6]);
    expect(result.candidates.every((c) => c.netCreditMid > 0)).toBe(true);
  });

  it("caps quote concurrency at the market data lines granted", async () => {
    marketDataLineRegistry.reserve("test-hog", 97);
    getOptionQuotes.mockResolvedValue(new Map());

    await findRollCandidates(request);

    expect(getOptionQuotes.mock.calls[0][1]).toMatchObject({ concurrency: 3 });
  });

  it("fails loudly when no market data lines are available", async () => {
    marketDataLineRegistry.reserve("test-hog", 100);

    await expect(findRollCandidates(request)).rejects.toThrow(/market data lines/);
    expect(getOptionQuotes).not.toHaveBeenCalled();
  });

  it("fails loudly when a contract lookup fails instead of returning conId 0", async () => {
    getOptionContracts.mockRejectedValue(new Error("getOptionContracts timed out for ZAG 20261023"));

    await expect(findRollCandidates(request)).rejects.toThrow(/timed out for ZAG 20261023/);
    expect(getOptionQuotes).not.toHaveBeenCalled();
  });
});
