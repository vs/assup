/**
 * Tests for the findRollCandidates IBKR flow.
 *
 * Regression cover for ZAG roll scans never returning: the scan requested
 * quotes for every strike in the union chain (half of which are not listed
 * for a given expiry) through serial 2s snapshots, blowing the client's 90s
 * timeout, while parallel contract-details lookups timed out and silently
 * left every candidate with conId 0.
 *
 * Also covers ZUL rolls showing the new leg's full premium as "net credit":
 * the close leg was quoted via a 5s snapshot that timed out, and the missing
 * price silently became bid/ask 0.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Contract } from "@stoqey/ib";

const getOptionChain = vi.fn();
const getOptionContracts = vi.fn();
const getOptionQuotes = vi.fn();

vi.mock("../../services/ibkr.js", () => ({
  ibkrService: {
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

const CLOSE_KEY = "SLV_20260918_57_C";

/** Quote the close leg at 1.0/1.2 and every candidate at the given bid/ask. */
function quoteAll(candidate: { bid: number; ask: number } = { bid: 2.0, ask: 2.2 }) {
  getOptionQuotes.mockImplementation(async (contracts: Contract[]) =>
    new Map(contracts.map((c) => {
      const key = `SLV_${c.lastTradeDateOrContractMonth}_${c.strike}_C`;
      return [key, key === CLOSE_KEY ? { bid: 1.0, ask: 1.2 } : candidate];
    })),
  );
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
    quoteAll();
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
    const result = await findRollCandidates(request);

    const quoted = (getOptionQuotes.mock.calls[1][0] as Contract[]).map((c) => c.conId);
    expect(quoted.sort()).toEqual([2, 3, 4, 5, 6]); // strike 56 is below the current call strike
    expect(getOptionContracts).toHaveBeenCalledWith("ZAG", "20261023", "ZAG", 100, "C");
    expect(result.candidates.map((c) => c.conId).sort()).toEqual([2, 3, 4, 5, 6]);
    expect(result.candidates.every((c) => c.netCreditMid > 0)).toBe(true);
  });

  it("quotes the close leg by streaming and nets its price out of each candidate", async () => {
    const result = await findRollCandidates(request);

    const [closeContracts] = getOptionQuotes.mock.calls[0] as [Contract[]];
    expect(closeContracts).toHaveLength(1);
    expect(closeContracts[0]).toMatchObject({ conId: 111, strike: 57, right: "C" });
    expect(result.closeLeg).toEqual({ conId: 111, bid: 1.0, ask: 1.2, mid: 1.1 });
    expect(result.candidates[0].netCreditMid).toBeCloseTo(2.1 - 1.1);
    expect(result.candidates[0].netCredit).toBeCloseTo(2.0 - 1.2);
  });

  it("fails loudly when the close leg has no quote instead of treating its price as 0", async () => {
    getOptionQuotes.mockResolvedValue(new Map());

    await expect(findRollCandidates(request)).rejects.toThrow(/No quote from TWS for ZAG 20260918 57C/);
    expect(getOptionChain).not.toHaveBeenCalled();
  });

  it("releases the close leg's market data line after quoting it", async () => {
    await findRollCandidates(request);

    expect(marketDataLineRegistry.used()).toBe(0);
  });

  it("caps quote concurrency at the market data lines granted", async () => {
    marketDataLineRegistry.reserve("test-hog", 97);

    await findRollCandidates(request);

    expect(getOptionQuotes.mock.calls[1][1]).toMatchObject({ concurrency: 3 });
  });

  it("fails loudly when no market data lines are available", async () => {
    marketDataLineRegistry.reserve("test-hog", 100);

    await expect(findRollCandidates(request)).rejects.toThrow(/market data lines/);
    expect(getOptionQuotes).not.toHaveBeenCalled();
  });

  it("fails loudly when a contract lookup fails instead of returning conId 0", async () => {
    getOptionContracts.mockRejectedValue(new Error("getOptionContracts timed out for ZAG 20261023"));

    await expect(findRollCandidates(request)).rejects.toThrow(/timed out for ZAG 20261023/);
    expect(getOptionQuotes).toHaveBeenCalledTimes(1); // close leg only
  });
});
