import { describe, it, expect } from "vitest";
import { groupSpreads } from "../../services/spreadGrouping.js";
import type { OptionTradeGroup, OptionTradeDetail } from "@assup/shared";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal OptionTradeDetail. */
function makeDetail(overrides: Partial<OptionTradeDetail> & { buySell: string; tradeDate: string }): OptionTradeDetail {
  return {
    id: "td-" + Math.random().toString(36).slice(2, 8),
    symbol: "AAPL  250321P00200000",
    underlying: "AAPL",
    strike: 200,
    expiry: "2025-03-21",
    right: "P",
    tradeDate: overrides.tradeDate,
    quantity: 1,
    tradePrice: 1.5,
    proceeds: 150,
    commission: -1.3,
    buySell: overrides.buySell,
    wasAssigned: false,
    ...overrides,
  };
}

/** Build a minimal OptionTradeGroup (short leg by default). */
function makeGroup(overrides: Partial<OptionTradeGroup> & {
  underlying: string;
  strike: number;
  expiry: string;
  right: "C" | "P";
  openBuySell: string;
  openDate: string;
  quantity?: number;
}): OptionTradeGroup {
  const qty = overrides.quantity ?? 1;
  const openTrade = makeDetail({
    buySell: overrides.openBuySell,
    tradeDate: overrides.openDate,
    underlying: overrides.underlying,
    strike: overrides.strike,
    expiry: overrides.expiry,
    right: overrides.right,
    quantity: qty,
  });

  return {
    underlying: overrides.underlying,
    strike: overrides.strike,
    expiry: overrides.expiry,
    right: overrides.right,
    openTrade,
    closeTrade: overrides.closeTrade ?? undefined,
    costBasis: overrides.costBasis ?? 150,
    sellPrice: overrides.sellPrice ?? 0,
    profit: overrides.profit ?? 150,
    wasAssigned: overrides.wasAssigned ?? false,
    expiredWorthless: overrides.expiredWorthless ?? true,
    assetClassId: overrides.assetClassId,
    assetClassName: overrides.assetClassName,
    assetClassColor: overrides.assetClassColor,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("groupSpreads", () => {
  // 1. Empty input → empty result
  it("returns empty spreads and remaining for empty input", () => {
    const { spreads, remaining } = groupSpreads([], ["AAPL"]);
    expect(spreads).toEqual([]);
    expect(remaining).toEqual([]);
  });

  // 2. Non-eligible underlyings → all go to remaining
  it("sends non-eligible underlyings to remaining", () => {
    const leg = makeGroup({
      underlying: "TSLA",
      strike: 200,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "SELL",
      openDate: "2025-03-10",
    });
    const { spreads, remaining } = groupSpreads([leg], ["AAPL"]);
    expect(spreads).toHaveLength(0);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(leg);
  });

  // 3. Credit put spread matching
  it("matches a credit put spread (SELL higher + BUY lower, same expiry/qty/day)", () => {
    const shortPut = makeGroup({
      underlying: "AAPL",
      strike: 200,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "SELL",
      openDate: "2025-03-10",
      costBasis: 300,
      profit: 300,
    });
    const longPut = makeGroup({
      underlying: "AAPL",
      strike: 190,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "BUY",
      openDate: "2025-03-10",
      costBasis: 100,
      profit: -100,
    });

    const { spreads, remaining } = groupSpreads([shortPut, longPut], ["AAPL"]);

    expect(spreads).toHaveLength(1);
    expect(remaining).toHaveLength(0);

    const sp = spreads[0];
    expect(sp.type).toBe("put-spread");
    expect(sp.underlying).toBe("AAPL");
    expect(sp.expiry).toBe("2025-03-21");
    expect(sp.legs).toHaveLength(2);
    expect(sp.costBasis).toBe(200); // 300 - 100 (net credit = max profit)
    expect(sp.profit).toBe(200);    // 300 + (-100)
  });

  // 4. Credit call spread matching
  it("matches a credit call spread (SELL lower + BUY higher)", () => {
    const shortCall = makeGroup({
      underlying: "AAPL",
      strike: 210,
      expiry: "2025-04-18",
      right: "C",
      openBuySell: "SELL",
      openDate: "2025-03-15",
      costBasis: 250,
      profit: 250,
    });
    const longCall = makeGroup({
      underlying: "AAPL",
      strike: 220,
      expiry: "2025-04-18",
      right: "C",
      openBuySell: "BUY",
      openDate: "2025-03-15",
      costBasis: 80,
      profit: -80,
    });

    const { spreads, remaining } = groupSpreads([shortCall, longCall], ["AAPL"]);

    expect(spreads).toHaveLength(1);
    expect(remaining).toHaveLength(0);

    const sp = spreads[0];
    expect(sp.type).toBe("call-spread");
    expect(sp.underlying).toBe("AAPL");
    expect(sp.expiry).toBe("2025-04-18");
    expect(sp.legs).toHaveLength(2);
    expect(sp.costBasis).toBe(170); // 250 - 80 (net credit = max profit)
    expect(sp.profit).toBe(170);
  });

  // 5. Iron condor matching (put spread + call spread combined)
  it("matches an iron condor from put spread + call spread", () => {
    const shortPut = makeGroup({
      underlying: "SPY",
      strike: 540,
      expiry: "2025-04-18",
      right: "P",
      openBuySell: "SELL",
      openDate: "2025-03-15",
      costBasis: 200,
      profit: 200,
    });
    const longPut = makeGroup({
      underlying: "SPY",
      strike: 530,
      expiry: "2025-04-18",
      right: "P",
      openBuySell: "BUY",
      openDate: "2025-03-15",
      costBasis: 80,
      profit: -80,
    });
    const shortCall = makeGroup({
      underlying: "SPY",
      strike: 570,
      expiry: "2025-04-18",
      right: "C",
      openBuySell: "SELL",
      openDate: "2025-03-15",
      costBasis: 180,
      profit: 180,
    });
    const longCall = makeGroup({
      underlying: "SPY",
      strike: 580,
      expiry: "2025-04-18",
      right: "C",
      openBuySell: "BUY",
      openDate: "2025-03-15",
      costBasis: 60,
      profit: -60,
    });

    const { spreads, remaining } = groupSpreads(
      [shortPut, longPut, shortCall, longCall],
      ["SPY"],
    );

    expect(spreads).toHaveLength(1);
    expect(remaining).toHaveLength(0);

    const ic = spreads[0];
    expect(ic.type).toBe("iron-condor");
    expect(ic.underlying).toBe("SPY");
    expect(ic.legs).toHaveLength(4);
    expect(ic.costBasis).toBe(240);  // (200 - 80) + (180 - 60) (net credit = max profit)
    expect(ic.profit).toBe(240);     // 200 + (-80) + 180 + (-60)
  });

  // 6. Partial status (legs with mixed expired/closed outcomes)
  it("reports partial status when legs have mixed outcomes", () => {
    const closedDetail = makeDetail({
      buySell: "BUY",
      tradeDate: "2025-03-20",
    });

    const shortPut = makeGroup({
      underlying: "AAPL",
      strike: 200,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "SELL",
      openDate: "2025-03-10",
      expiredWorthless: false,
      closeTrade: closedDetail,
      costBasis: 300,
      sellPrice: 50,
      profit: 250,
    });
    const longPut = makeGroup({
      underlying: "AAPL",
      strike: 190,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "BUY",
      openDate: "2025-03-10",
      expiredWorthless: true,     // this one expired
      costBasis: 100,
      profit: -100,
    });

    const { spreads } = groupSpreads([shortPut, longPut], ["AAPL"]);

    expect(spreads).toHaveLength(1);
    expect(spreads[0].status).toBe("partial");
  });

  // 7. 1-day tolerance (legs opened 1 day apart still match)
  it("matches legs opened exactly 1 day apart", () => {
    const shortPut = makeGroup({
      underlying: "AAPL",
      strike: 200,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "SELL",
      openDate: "2025-03-10",
    });
    const longPut = makeGroup({
      underlying: "AAPL",
      strike: 190,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "BUY",
      openDate: "2025-03-11", // next day
    });

    const { spreads, remaining } = groupSpreads([shortPut, longPut], ["AAPL"]);

    expect(spreads).toHaveLength(1);
    expect(remaining).toHaveLength(0);
    expect(spreads[0].type).toBe("put-spread");
  });

  // 8. Rejection when legs opened more than 1 day apart
  it("rejects legs opened more than 1 day apart", () => {
    const shortPut = makeGroup({
      underlying: "AAPL",
      strike: 200,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "SELL",
      openDate: "2025-03-10",
    });
    const longPut = makeGroup({
      underlying: "AAPL",
      strike: 190,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "BUY",
      openDate: "2025-03-13", // 3 days later
    });

    const { spreads, remaining } = groupSpreads([shortPut, longPut], ["AAPL"]);

    expect(spreads).toHaveLength(0);
    expect(remaining).toHaveLength(2);
  });

  // 9. Unmatched naked legs go to remaining
  it("puts unmatched naked legs in remaining", () => {
    const nakedPut = makeGroup({
      underlying: "AAPL",
      strike: 200,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "SELL",
      openDate: "2025-03-10",
    });

    const { spreads, remaining } = groupSpreads([nakedPut], ["AAPL"]);

    expect(spreads).toHaveLength(0);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(nakedPut);
  });

  // 10. Quantity mismatch rejection
  it("rejects legs with different quantities", () => {
    const shortPut = makeGroup({
      underlying: "AAPL",
      strike: 200,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "SELL",
      openDate: "2025-03-10",
      quantity: 2,
    });
    const longPut = makeGroup({
      underlying: "AAPL",
      strike: 190,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "BUY",
      openDate: "2025-03-10",
      quantity: 1,
    });

    const { spreads, remaining } = groupSpreads([shortPut, longPut], ["AAPL"]);

    expect(spreads).toHaveLength(0);
    expect(remaining).toHaveLength(2);
  });

  // Additional edge-case: status "expired" when all legs expired worthless
  it("reports expired status when all legs expired worthless", () => {
    const shortPut = makeGroup({
      underlying: "AAPL",
      strike: 200,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "SELL",
      openDate: "2025-03-10",
      expiredWorthless: true,
    });
    const longPut = makeGroup({
      underlying: "AAPL",
      strike: 190,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "BUY",
      openDate: "2025-03-10",
      expiredWorthless: true,
    });

    const { spreads } = groupSpreads([shortPut, longPut], ["AAPL"]);

    expect(spreads).toHaveLength(1);
    expect(spreads[0].status).toBe("expired");
  });

  // Additional edge-case: status "closed" when all legs have closeTrade and not expired
  it("reports closed status when all legs were closed (not expired)", () => {
    const closedDetail1 = makeDetail({ buySell: "BUY", tradeDate: "2025-03-18" });
    const closedDetail2 = makeDetail({ buySell: "SELL", tradeDate: "2025-03-18" });

    const shortPut = makeGroup({
      underlying: "AAPL",
      strike: 200,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "SELL",
      openDate: "2025-03-10",
      expiredWorthless: false,
      closeTrade: closedDetail1,
      costBasis: 300,
      sellPrice: 100,
      profit: 200,
    });
    const longPut = makeGroup({
      underlying: "AAPL",
      strike: 190,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "BUY",
      openDate: "2025-03-10",
      expiredWorthless: false,
      closeTrade: closedDetail2,
      costBasis: 100,
      sellPrice: 30,
      profit: -70,
    });

    const { spreads } = groupSpreads([shortPut, longPut], ["AAPL"]);

    expect(spreads).toHaveLength(1);
    expect(spreads[0].status).toBe("closed");
  });

  // Commissions are summed across all legs
  it("sums commissions from all leg open and close trades", () => {
    const closedShort = makeDetail({ buySell: "BUY", tradeDate: "2025-03-18", commission: -1.5 });
    const closedLong = makeDetail({ buySell: "SELL", tradeDate: "2025-03-18", commission: -1.5 });

    const shortPut = makeGroup({
      underlying: "AAPL",
      strike: 200,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "SELL",
      openDate: "2025-03-10",
      expiredWorthless: false,
      closeTrade: closedShort,
    });
    // Override the open trade commission for predictable values
    shortPut.openTrade!.commission = -1.3;

    const longPut = makeGroup({
      underlying: "AAPL",
      strike: 190,
      expiry: "2025-03-21",
      right: "P",
      openBuySell: "BUY",
      openDate: "2025-03-10",
      expiredWorthless: false,
      closeTrade: closedLong,
    });
    longPut.openTrade!.commission = -1.3;

    const { spreads } = groupSpreads([shortPut, longPut], ["AAPL"]);

    expect(spreads).toHaveLength(1);
    // -1.3 (short open) + -1.5 (short close) + -1.3 (long open) + -1.5 (long close) = -5.6
    expect(spreads[0].commissions).toBeCloseTo(-5.6, 2);
  });

  it("matches spread when openTrade is missing (infers side from closeTrade)", () => {
    // FLEX period doesn't include the open trade — only close trades exist
    // Short put was SELL-to-open → BUY-to-close
    const shortPut: OptionTradeGroup = {
      underlying: "SPX",
      strike: 5200,
      expiry: "2026-03-21",
      right: "P",
      costBasis: 1500,
      sellPrice: 200,
      profit: 1300,
      wasAssigned: false,
      expiredWorthless: false,
      openTrade: undefined,
      closeTrade: {
        id: "1c", symbol: "SPX", underlying: "SPX", strike: 5200,
        expiry: "2026-03-21", right: "P", tradeDate: "2026-03-15",
        quantity: 1, tradePrice: 2, proceeds: -200, commission: -1,
        buySell: "BUY", wasAssigned: false,
      },
    };
    // Long put was BUY-to-open → SELL-to-close
    const longPut: OptionTradeGroup = {
      underlying: "SPX",
      strike: 5100,
      expiry: "2026-03-21",
      right: "P",
      costBasis: 800,
      sellPrice: 50,
      profit: -750,
      wasAssigned: false,
      expiredWorthless: false,
      openTrade: undefined,
      closeTrade: {
        id: "2c", symbol: "SPX", underlying: "SPX", strike: 5100,
        expiry: "2026-03-21", right: "P", tradeDate: "2026-03-15",
        quantity: 1, tradePrice: 0.5, proceeds: 50, commission: -1,
        buySell: "SELL", wasAssigned: false,
      },
    };
    const result = groupSpreads([shortPut, longPut], ["SPX"]);
    expect(result.spreads).toHaveLength(1);
    expect(result.spreads[0].type).toBe("put-spread");
    expect(result.spreads[0].profit).toBe(1300 + -750);
    expect(result.remaining).toHaveLength(0);
  });
});
