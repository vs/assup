import { describe, it, expect } from "vitest";
import { groupOptionTrades, type OptionTradeInput } from "../../services/tradeMatching.js";

function makeOptInput(overrides: Partial<OptionTradeInput> & { id: string; tradeDate: string }): OptionTradeInput {
  return {
    tradeId: overrides.id,
    symbol: "QZAC  260515C00175000",
    description: null,
    conId: 12345,
    strike: 175,
    expiry: new Date("2026-05-15"),
    right: "C",
    underlying: "QZAC",
    quantity: 1,
    tradePrice: 1.0,
    proceeds: 0,
    commission: 0,
    buySell: "BUY",
    openClose: "C",
    wasAssigned: false,
    costBasis: null,
    realizedPnl: null,
    ...overrides,
    tradeDate: new Date(overrides.tradeDate),
  };
}

describe("groupOptionTrades — missingOpenTrade with IBKR realizedPnl", () => {
  // Regression: when only the closing trade is present and IBKR provides realizedPnl
  // (e.g., live TWS executions whose corresponding open trade is in an earlier FLEX
  // period), costBasis must be derived as |realizedPnl - proceeds_close|, NOT
  // |realizedPnl + proceeds_close|. The latter inflates costBasis ~order-of-magnitude
  // and caused detectSpreadGroups to compute the wrong sign for spread P&L.
  it("derives correct cost basis for a BUY-to-close (closing short) with loss", () => {
    // Closing a short call: originally sold for $185 premium, bought back for $4980.
    // realizedPnl = 185 + (-4980) = -4795.
    const groups = groupOptionTrades([
      makeOptInput({
        id: "tws-short-close",
        tradeDate: "2026-05-15",
        buySell: "BUY",
        quantity: 1,
        tradePrice: 49.8,
        proceeds: -4980,
        realizedPnl: -4795,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].profit).toBeCloseTo(-4795, 2);
    expect(groups[0].costBasis).toBeCloseTo(185, 2);
  });

  it("derives correct cost basis for a SELL-to-close (closing long) with profit", () => {
    // Closing a long call: originally bought for $114 premium, sold for $3980.
    // realizedPnl = -114 + 3980 = 3866.
    const groups = groupOptionTrades([
      makeOptInput({
        id: "tws-long-close",
        strike: 185,
        symbol: "QZAC  260515C00185000",
        tradeDate: "2026-05-15",
        buySell: "SELL",
        quantity: 1,
        tradePrice: 39.8,
        proceeds: 3980,
        realizedPnl: 3866,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].profit).toBeCloseTo(3866, 2);
    expect(groups[0].costBasis).toBeCloseTo(114, 2);
  });
});
