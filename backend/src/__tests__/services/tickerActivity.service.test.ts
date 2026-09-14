import { describe, it, expect, vi } from "vitest";

// The service also exposes a DB-backed loader; stub prisma so importing it here
// doesn't demand a database connection for these pure-function tests.
vi.mock("../../db/index.js", () => ({
  prisma: { cashTransaction: { findMany: vi.fn() }, importedTrade: { findMany: vi.fn() } },
}));

import { buildTickerActivity } from "../../services/tickerActivity.service.js";
import type { OptionTradeInput, StockTradeInput } from "../../services/tradeMatching.js";

// All fixture dates are in the past so hasExpiryPassed() is deterministic.

function optionTrade(over: Partial<OptionTradeInput> & { id: string }): OptionTradeInput {
  return {
    tradeId: over.id,
    symbol: "TLT",
    description: null,
    conId: 1,
    strike: 89,
    expiry: new Date("2024-01-19"),
    right: "P",
    underlying: "TLT",
    tradeDate: new Date("2024-01-02"),
    quantity: 1,
    tradePrice: 1.55,
    proceeds: 155,
    commission: -1.05,
    buySell: "SELL",
    openClose: "O",
    wasAssigned: false,
    costBasis: null,
    realizedPnl: null,
    ...over,
  };
}

function stockTrade(over: Partial<StockTradeInput> & { id: string }): StockTradeInput {
  return {
    tradeId: over.id,
    symbol: "TLT",
    tradeDate: new Date("2024-01-22"),
    quantity: 100,
    tradePrice: 89,
    proceeds: -8900,
    commission: -1,
    buySell: "BUY",
    openClose: "O",
    costBasis: null,
    realizedPnl: null,
    ...over,
  };
}

describe("buildTickerActivity", () => {
  it("reports a short put that expired worthless as a closed entry", () => {
    const result = buildTickerActivity("TLT", [optionTrade({ id: "o1" })], [], [], []);

    expect(result.open).toHaveLength(0);
    expect(result.closed).toHaveLength(1);

    const entry = result.closed[0];
    expect(entry.kind).toBe("OPTION");
    expect(entry.status).toBe("expired");
    // premium 155 + commission (-1.05)
    expect(entry.realizedPnL).toBeCloseTo(153.95, 2);
    expect(entry.unrealizedPnL).toBeNull();
    expect(entry.displayName).toBe("TLT Jan19'24 89 PUT");
    expect(entry.openLeg?.action).toBe("Sold PUT");
    expect(entry.sortDate).toBe("2024-01-19");

    expect(result.summary.optionsPnL).toBeCloseTo(153.95, 2);
    expect(result.summary.total).toBeCloseTo(153.95, 2);
    expect(result.summary.entryCount).toBe(1);
  });

  it("does not double-count assigned-call premium in the share entry", () => {
    const options = [
      // Short put, assigned -> we buy 100 shares at 89
      optionTrade({ id: "o1", wasAssigned: true }),
      // Covered call, assigned -> shares called away at 92
      optionTrade({
        id: "o2",
        conId: 2,
        strike: 92,
        right: "C",
        expiry: new Date("2024-02-16"),
        tradeDate: new Date("2024-01-25"),
        tradePrice: 1.2,
        proceeds: 120,
        wasAssigned: true,
      }),
    ];
    const stocks = [
      stockTrade({ id: "s1" }),
      stockTrade({
        id: "s2",
        tradeDate: new Date("2024-02-16"),
        tradePrice: 92,
        proceeds: 9200,
        buySell: "SELL",
        openClose: "C",
        costBasis: -8900,
        // Deliberately wrong: IBKR bakes the call premium in here. Must be ignored.
        realizedPnl: 420,
      }),
    ];

    const result = buildTickerActivity("TLT", options, stocks, [], []);

    const stockEntry = result.closed.find((e) => e.kind === "STOCK");
    expect(stockEntry).toBeDefined();
    // sellProceeds (9200 - 1) - costBasis 8900
    expect(stockEntry!.realizedPnL).toBeCloseTo(299, 2);
    expect(stockEntry!.status).toBe("called_away");
    expect(stockEntry!.closeLeg?.action).toBe("Called away");

    // 153.95 (put) + 118.95 (call) + 299 (shares)
    expect(result.summary.optionsPnL).toBeCloseTo(272.9, 2);
    expect(result.summary.stockPnL).toBeCloseTo(299, 2);
    expect(result.summary.total).toBeCloseTo(571.9, 2);
  });

  it("reports a long option closed at a loss", () => {
    const options = [
      optionTrade({
        id: "o1",
        conId: 3,
        right: "C",
        strike: 100,
        expiry: new Date("2024-03-15"),
        tradeDate: new Date("2024-02-01"),
        tradePrice: 3,
        proceeds: -300,
        buySell: "BUY",
        openClose: "O",
      }),
      optionTrade({
        id: "o2",
        conId: 3,
        right: "C",
        strike: 100,
        expiry: new Date("2024-03-15"),
        tradeDate: new Date("2024-02-20"),
        tradePrice: 1.8,
        proceeds: 180,
        buySell: "SELL",
        openClose: "C",
      }),
    ];

    const result = buildTickerActivity("TLT", options, [], [], []);

    expect(result.closed).toHaveLength(1);
    const entry = result.closed[0];
    expect(entry.status).toBe("closed");
    // 180 - 300 + (-1.05 - 1.05)
    expect(entry.realizedPnL).toBeCloseTo(-122.1, 2);
    expect(entry.openLeg?.action).toBe("Bought CALL");
    expect(entry.sortDate).toBe("2024-02-20");
  });

  it("returns empty arrays and a zeroed summary for a symbol with no history", () => {
    const result = buildTickerActivity("TLT", [], [], [], []);

    expect(result.symbol).toBe("TLT");
    expect(result.open).toEqual([]);
    expect(result.closed).toEqual([]);
    expect(result.summary).toEqual({
      optionsPnL: 0,
      stockPnL: 0,
      dividends: 0,
      total: 0,
      entryCount: 0,
      firstDate: null,
      lastDate: null,
    });
  });

  it("nets withholding cancel/re-issue rows into a single dividend entry", () => {
    const payDate = new Date("2024-03-07");
    const rows = [
      {
        type: "DIVIDEND" as const,
        transactionDate: payDate,
        description:
          "TLT(USZ958700214) CASH DIVIDEND USD 0.330454 PER SHARE (Ordinary Dividend)",
        amountUsd: 33.05,
      },
      {
        type: "WITHHOLDING_TAX" as const,
        transactionDate: payDate,
        description: "TLT(USZ958700214) CASH DIVIDEND USD 0.330454 PER SHARE - US TAX",
        amountUsd: -9.92,
      },
      // IBKR cancels the first withholding and re-issues it at a lower rate.
      {
        type: "WITHHOLDING_TAX" as const,
        transactionDate: payDate,
        description: "TLT(USZ958700214) CASH DIVIDEND USD 0.330454 PER SHARE - US TAX",
        amountUsd: 9.92,
      },
      {
        type: "WITHHOLDING_TAX" as const,
        transactionDate: payDate,
        description: "TLT(USZ958700214) CASH DIVIDEND USD 0.330454 PER SHARE - US TAX",
        amountUsd: -4.96,
      },
    ];

    const result = buildTickerActivity("TLT", [], [], rows, []);

    expect(result.closed).toHaveLength(1);
    const entry = result.closed[0];
    expect(entry.kind).toBe("DIVIDEND");
    expect(entry.status).toBe("paid");
    expect(entry.sortDate).toBe("2024-03-07");
    expect(entry.dividend).not.toBeNull();
    expect(entry.dividend!.perShare).toBeCloseTo(0.330454, 6);
    expect(entry.dividend!.shares).toBeCloseTo(100, 0);
    expect(entry.dividend!.gross).toBeCloseTo(33.05, 2);
    expect(entry.dividend!.withholdingTax).toBeCloseTo(-4.96, 2);
    // 33.05 - 4.96
    expect(entry.realizedPnL).toBeCloseTo(28.09, 2);

    expect(result.summary.dividends).toBeCloseTo(28.09, 2);
    expect(result.summary.total).toBeCloseTo(28.09, 2);
  });

  it("attaches unrealized P&L to an open option from the live position", () => {
    const openPut = optionTrade({
      id: "o1",
      conId: 20,
      strike: 90,
      expiry: new Date("2099-03-20"),
      tradeDate: new Date("2024-02-01"),
    });

    const positions = [
      {
        account: "U1",
        symbol: "TLT Mar20'99 90 PUT",
        conId: 20,
        secType: "OPT",
        exchange: "SMART",
        currency: "USD",
        position: -1,
        avgCost: 155,
        costBasis: -155,
        marketValue: -93,
        unrealizedPnl: 62,
        strike: 90,
        expiry: "20990320",
        right: "P" as const,
        underlying: "TLT",
        assetClassId: null,
        assetClassName: null,
        assetClassColor: null,
      },
    ];

    const result = buildTickerActivity("TLT", [openPut], [], [], positions);

    expect(result.closed).toHaveLength(0);
    expect(result.open).toHaveLength(1);
    expect(result.open[0].status).toBe("open");
    expect(result.open[0].realizedPnL).toBeNull();
    expect(result.open[0].unrealizedPnL).toBe(62);
    // Open entries contribute nothing to realized totals.
    expect(result.summary.total).toBe(0);
    expect(result.summary.entryCount).toBe(0);
  });

  it("leaves unrealized P&L null when TWS returns no positions", () => {
    const openPut = optionTrade({
      id: "o1",
      conId: 20,
      strike: 90,
      expiry: new Date("2099-03-20"),
      tradeDate: new Date("2024-02-01"),
    });

    const result = buildTickerActivity("TLT", [openPut], [], [], []);

    expect(result.open).toHaveLength(1);
    expect(result.open[0].unrealizedPnL).toBeNull();
  });

  it("orders closed entries newest-first", () => {
    const options = [
      optionTrade({ id: "old", conId: 10 }),
      optionTrade({
        id: "new",
        conId: 11,
        expiry: new Date("2024-06-21"),
        tradeDate: new Date("2024-05-01"),
      }),
    ];

    const result = buildTickerActivity("TLT", options, [], [], []);

    expect(result.closed.map((e) => e.sortDate)).toEqual(["2024-06-21", "2024-01-19"]);
    expect(result.summary.firstDate).toBe("2024-01-19");
    expect(result.summary.lastDate).toBe("2024-06-21");
  });
});
