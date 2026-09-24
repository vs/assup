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

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Contract } from "@stoqey/ib";

const getOptionChain = vi.fn();
const getOptionContracts = vi.fn();
const quoteGet = vi.fn();

vi.mock("../../services/ibkr.js", () => ({
  ibkrService: {
    getOptionChain: (...args: unknown[]) => getOptionChain(...args),
    getOptionContracts: (...args: unknown[]) => getOptionContracts(...args),
  },
}));

vi.mock("../../services/quotes/index.js", async () => {
  const keys = await vi.importActual<typeof import("../../services/quotes/quoteKey.js")>("../../services/quotes/quoteKey.js");
  return {
    quoteHub: { get: (...args: unknown[]) => quoteGet(...args) },
    quoteKey: keys.quoteKey,
    summarizeStatuses: keys.summarizeStatuses,
  };
});

const { findRollCandidates } = await import("../../services/rollCandidates.service.js");
const { quoteKey } = await import("../../services/quotes/quoteKey.js");
import type { Quote, QuoteContract } from "../../services/quotes/quoteTypes.js";

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

const CLOSE_CONID = 111;

/** Answer quoteHub.get: close leg 1.0/1.2 (unless overridden), candidates at `candidate`. */
function quoteAll(candidate: Partial<Quote> = { status: "ok", bid: 2.0, ask: 2.2 }, close: Partial<Quote> = { status: "ok", bid: 1.0, ask: 1.2 }) {
  quoteGet.mockImplementation(async (contracts: QuoteContract[]) =>
    new Map(contracts.map((c) => {
      const key = quoteKey(c);
      return [key, { key, updatedAt: 1, ...(c.conId === CLOSE_CONID ? close : candidate) } as Quote];
    })),
  );
}

const request = {
  symbol: "ZAG",
  expiration: "20260918",
  strike: 57,
  right: "C" as const,
  conId: CLOSE_CONID,
  minDTEBeyond: 30,
};

describe("findRollCandidates", () => {
  beforeEach(() => {
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

  it("quotes only listed contracts, by conId, and returns their real conIds", async () => {
    const result = await findRollCandidates(request);

    const [contracts, opts] = quoteGet.mock.calls[1] as [QuoteContract[], { fields: string[] }];
    expect(contracts.map((c) => c.conId).sort()).toEqual([2, 3, 4, 5, 6]); // strike 56 is below the current call strike
    expect(opts.fields).toEqual(["bid", "ask"]);
    expect(getOptionContracts).toHaveBeenCalledWith("ZAG", "20261023", "ZAG", 100, "C");
    expect(result.candidates.map((c) => c.conId).sort()).toEqual([2, 3, 4, 5, 6]);
    expect(result.candidates.every((c) => c.netCreditMid > 0)).toBe(true);
  });

  it("quotes the close leg first and nets its price out of each candidate", async () => {
    const result = await findRollCandidates(request);

    const [closeContracts] = quoteGet.mock.calls[0] as [QuoteContract[]];
    expect(closeContracts).toEqual([expect.objectContaining({ conId: CLOSE_CONID, strike: 57, right: "C" })]);
    expect(result.closeLeg).toEqual({ conId: CLOSE_CONID, bid: 1.0, ask: 1.2, mid: 1.1 });
    expect(result.candidates[0].netCreditMid).toBeCloseTo(2.1 - 1.1);
    expect(result.candidates[0].netCredit).toBeCloseTo(2.0 - 1.2);
  });

  it("fails loudly when the close leg has no quote instead of treating its price as 0", async () => {
    quoteAll(undefined, { status: "timeout" });

    await expect(findRollCandidates(request)).rejects.toThrow(/No quote from TWS for ZAG 20260918 57C .*timeout/);
    expect(getOptionChain).not.toHaveBeenCalled();
  });

  it("names the TWS reason when the close leg has no market", async () => {
    quoteAll(undefined, { status: "no-market", noMarket: ["bid", "ask"] });

    await expect(findRollCandidates(request)).rejects.toThrow(/no-market/);
  });

  it("returns losing rolls too, sorted by net credit, so a debit roll can be chosen", async () => {
    // Candidates cost 0.5 to open, the close leg costs 1.1 to buy back: a debit roll.
    quoteAll({ status: "ok", bid: 0.45, ask: 0.55 });

    const result = await findRollCandidates(request);

    expect(result.candidates).toHaveLength(5);
    expect(result.candidates[0].netCreditMid).toBeLessThan(0);
    const credits = result.candidates.map((c) => c.netCreditMid);
    expect([...credits].sort((a, b) => b - a)).toEqual(credits);
  });

  it("fails loudly when no candidate could be quoted", async () => {
    quoteAll({ status: "no-lines", error: "100/100 market data lines are in use" });

    await expect(findRollCandidates(request)).rejects.toThrow(/5 no-lines — 100\/100 market data lines are in use/);
  });

  it("fails loudly when a contract lookup fails instead of returning conId 0", async () => {
    getOptionContracts.mockRejectedValue(new Error("getOptionContracts timed out for ZAG 20261023"));

    await expect(findRollCandidates(request)).rejects.toThrow(/timed out for ZAG 20261023/);
    expect(quoteGet).toHaveBeenCalledTimes(1); // close leg only
  });
});
