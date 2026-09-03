import { describe, it, expect } from "vitest";
import {
  groupOptionTrades,
  groupStockTradesForWheel,
  type OptionTradeInput,
  type StockTradeInput,
} from "../../services/tradeMatching.js";

function makeStkInput(overrides: Partial<StockTradeInput> & { id: string; tradeDate: string }): StockTradeInput {
  return {
    tradeId: overrides.id,
    symbol: "QZJO",
    quantity: 100,
    tradePrice: 180,
    proceeds: 18000,
    commission: 0,
    buySell: "BUY",
    openClose: null,
    costBasis: null,
    realizedPnl: null,
    ...overrides,
    tradeDate: new Date(overrides.tradeDate),
  };
}

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

describe("groupStockTradesForWheel — IBKR cost basis and called-away P&L", () => {
  // Regression for the QZJO called-away bug: a wheel cycle had SOLD_PUT @ $180
  // (premium $126.95) → assignment buy of 100 shares → SOLD_CALL @ $180 (premium
  // $494.29) → called away at $180. IBKR returns the sell row with:
  //   cost_basis = -17873.05  (PUT-adjusted: $18000 - $126.95, signed negative)
  //   realized_pnl = 620.85   (includes assigned-CALL premium per §1234)
  // The displayed row must show buy@$178.73, sell@$180, profit≈$127. The CALL
  // premium ($494) belongs on its own option row, not baked into stock P&L.
  it("uses |costBasis| and stock-only profit for called-away shares", () => {
    const groups = groupStockTradesForWheel([
      makeStkInput({
        id: "qzjo-buy",
        tradeDate: "2026-01-30",
        buySell: "BUY",
        quantity: 100,
        tradePrice: 180,
        proceeds: -18000,
        costBasis: 18000,
        realizedPnl: 0,
      }),
      makeStkInput({
        id: "qzjo-sell",
        tradeDate: "2026-05-15",
        buySell: "SELL",
        quantity: -100,
        tradePrice: 180,
        proceeds: 18000,
        commission: -0.3903,
        costBasis: -17873.05204,
        realizedPnl: 620.846223,
      }),
    ]);

    const sold = groups.find(g => g.sellTrade);
    expect(sold).toBeDefined();
    expect(sold!.costBasis).toBeCloseTo(17873.05, 2);
    // buyPrice (used by stockGroupToWheelMatchedTrade) must be positive
    expect(sold!.costBasis / sold!.quantity).toBeCloseTo(178.73, 2);
    // Stock-only profit: sellProceeds − costBasis ≈ $18000 − $0.39 − $17873.05
    expect(sold!.profit).toBeCloseTo(126.56, 2);
  });

  it("handles a regular sell where IBKR realizedPnl == sellProceeds - costBasis", () => {
    const groups = groupStockTradesForWheel([
      makeStkInput({
        id: "stk-buy",
        tradeDate: "2026-01-01",
        buySell: "BUY",
        quantity: 100,
        tradePrice: 150,
        proceeds: -15000,
        costBasis: 15000,
        realizedPnl: 0,
      }),
      makeStkInput({
        id: "stk-sell",
        tradeDate: "2026-02-01",
        buySell: "SELL",
        quantity: -100,
        tradePrice: 160,
        proceeds: 16000,
        costBasis: -15000,
        realizedPnl: 1000,
      }),
    ]);

    const sold = groups.find(g => g.sellTrade);
    expect(sold).toBeDefined();
    expect(sold!.costBasis).toBeCloseTo(15000, 2);
    expect(sold!.profit).toBeCloseTo(1000, 2);
  });
});
