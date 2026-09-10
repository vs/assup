import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the prisma client before importing wheel.service so its top-level
// `prisma.corporateAction.findMany` call (during cycle reconstruction) is intercepted.
vi.mock("../../db/index.js", () => ({
  prisma: {
    corporateAction: { findMany: vi.fn(async () => []) },
  },
}));

// Mock IBKR service so cachedTodayTrades=[] path doesn't accidentally call it.
vi.mock("../../services/ibkr.js", () => ({
  ibkrService: {
    isConnected: () => false,
    getTodayTrades: vi.fn(async () => []),
    getPositions: vi.fn(async () => []),
    getMarketData: vi.fn(async () => null),
    getOptionGreeks: vi.fn(async () => null),
  },
}));

import { wheelService, normalizeSplitsForUnderlying } from "../../services/wheel.service.js";

interface RawTradeShape {
  id: string;
  tradeId?: string;
  tradeDate: Date;
  symbol: string;
  underlying: string | null;
  secType: string;
  strike: number | null;
  expiry: Date | null;
  right: string | null;
  quantity: number;
  tradePrice: number;
  proceeds: number;
  commission: number;
  buySell: string;
  openClose: string | null;
  wasAssigned: boolean;
  multiplier: number;
  costBasis: number | null;
  realizedPnl: number | null;
}

function makeTrade(overrides: Partial<RawTradeShape> & { id: string; tradeDate: string }): RawTradeShape {
  return {
    tradeId: overrides.id,
    symbol: "QZAC",
    underlying: "QZAC",
    secType: "OPT",
    strike: null,
    expiry: null,
    right: null,
    quantity: 1,
    tradePrice: 0,
    proceeds: 0,
    commission: 0,
    buySell: "SELL",
    openClose: "O",
    wasAssigned: false,
    multiplier: 100,
    costBasis: null,
    realizedPnl: null,
    ...overrides,
    tradeDate: new Date(overrides.tradeDate),
  };
}

describe("wheelService.reconstructCycles — long-leg trade handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression for the QZAC bear call spread bug: when a wheel cycle contains
  // both legs of a vertical spread (one short open + one long open) plus their
  // closes, position tracking previously ignored openClose and decremented the
  // short counter on both the long open (BUY-to-open) and the long close
  // (SELL-to-close). That caused the cycle to end prematurely, orphaning the
  // short-leg close trade and surfacing the spread loss as a fake gain.
  it("keeps both spread legs in one cycle and ends after the long close", async () => {
    const may15 = new Date("2026-05-15");
    const trades: RawTradeShape[] = [
      // Short PUT to open the cycle (a CSP-style entry)
      makeTrade({
        id: "open-put-120",
        tradeDate: "2026-04-20",
        symbol: "QZAC  260529P00120000",
        strike: 120,
        expiry: new Date("2026-05-29"),
        right: "P",
        buySell: "SELL",
        openClose: "O",
        quantity: -1,
        tradePrice: 4.45,
        proceeds: 445,
        commission: -0.81,
      }),
      // Short CALL leg of a bear call spread
      makeTrade({
        id: "open-call-175-short",
        tradeDate: "2026-04-30",
        symbol: "QZAC  260515C00175000",
        strike: 175,
        expiry: may15,
        right: "C",
        buySell: "SELL",
        openClose: "O",
        quantity: -1,
        tradePrice: 1.85,
        proceeds: 185,
        commission: -0.71,
      }),
      // Long CALL leg (BUY-to-open) — protective long, must NOT decrement short tracking
      makeTrade({
        id: "open-call-185-long",
        tradeDate: "2026-04-30",
        symbol: "QZAC  260515C00185000",
        strike: 185,
        expiry: may15,
        right: "C",
        buySell: "BUY",
        openClose: "O",
        quantity: 1,
        tradePrice: 1.14,
        proceeds: -114,
        commission: -0.70,
      }),
      // Close the short PUT for a small profit
      makeTrade({
        id: "close-put-120",
        tradeDate: "2026-05-12",
        symbol: "QZAC  260529P00120000",
        strike: 120,
        expiry: new Date("2026-05-29"),
        right: "P",
        buySell: "BUY",
        openClose: "C",
        quantity: 1,
        tradePrice: 1.20,
        proceeds: -120,
        commission: -0.80,
      }),
      // Close the short CALL at a large loss
      makeTrade({
        id: "close-call-175-short",
        tradeDate: "2026-05-15",
        symbol: "QZAC  260515C00175000",
        strike: 175,
        expiry: may15,
        right: "C",
        buySell: "BUY",
        openClose: "C",
        quantity: 1,
        tradePrice: 49.80,
        proceeds: -4980,
        commission: -1.05,
        realizedPnl: -4796.75,
        costBasis: 184.29,
      }),
      // Close the long CALL for a gain — SELL-to-close must NOT be treated as opening a short
      makeTrade({
        id: "close-call-185-long",
        tradeDate: "2026-05-15",
        symbol: "QZAC  260515C00185000",
        strike: 185,
        expiry: may15,
        right: "C",
        buySell: "SELL",
        openClose: "C",
        quantity: -1,
        tradePrice: 39.80,
        proceeds: 3980,
        commission: -1.13,
        realizedPnl: 3864.17,
        costBasis: -114.70,
      }),
    ];

    const cycles = await wheelService.reconstructCycles(
      "QZAC",
      null,
      [], // no live IBKR executions
      undefined, // no cachedData (so no unrealized P&L)
      { dbTrades: trades as never, assignedOptions: [] }
    );

    // The fix should produce ONE cycle covering all six trades.
    expect(cycles).toHaveLength(1);
    const cycle = cycles[0];

    expect(cycle.startDate).toBe("2026-04-20");
    expect(cycle.endDate).toBe("2026-05-15");
    expect(cycle.status).toBe("closed");

    // All four CALL trades plus both PUT trades should be matched into the cycle.
    // (matchTradesForCycle pairs opens with closes, so trade count is 3: 120 PUT pair,
    // 175 CALL pair, 185 CALL pair.)
    expect(cycle.trades).toHaveLength(3);

    // The bear call spread must be detected as a spread group with the real ~$930 loss.
    expect(cycle.spreadGroups).toHaveLength(1);
    const spread = cycle.spreadGroups[0];
    expect(spread.type).toMatch(/^call-/);
    expect(spread.shortLeg.openLeg?.action).toBe("Sold CALL");
    expect(spread.longLeg.openLeg?.action).toBe("Bought CALL");
    expect(spread.currentPnl).not.toBeNull();
    // currentPnl = netPremium + shortClose + longClose = 71 + (-4980) + 3980 = -929
    expect(spread.currentPnl!).toBeCloseTo(-929, 0);
  });

  // Regression for the QZBE cycle-5 bug: a cycle with TWO put assignments at
  // different strikes (100 @ $30, then 100 @ $21.50) ended by calling away all
  // 200 shares at $26. CALLED_AWAY priced ALL shares against entryStrike (the
  // first assignment's $30), giving (26-30)*200 = -800 instead of the true
  // (26-30)*100 + (26-21.5)*100 = +50, flipping a profitable cycle to a loss.
  it("uses per-lot cost basis when multiple assignments are called away together", async () => {
    const trades: RawTradeShape[] = [
      // First CSP, assigned at $30
      makeTrade({
        id: "open-put-30",
        tradeDate: "2026-01-30",
        symbol: "QZBE  260220P00030000",
        underlying: "QZBE",
        strike: 30,
        expiry: new Date("2026-02-20"),
        right: "P",
        buySell: "SELL",
        openClose: "O",
        quantity: -1,
        tradePrice: 0.3,
        proceeds: 30,
        wasAssigned: true,
      }),
      makeTrade({
        id: "assign-stock-30",
        tradeDate: "2026-02-20",
        symbol: "QZBE",
        underlying: "QZBE",
        secType: "STK",
        buySell: "BUY",
        openClose: "O",
        quantity: 100,
        tradePrice: 30,
        proceeds: -3000,
      }),
      makeTrade({
        id: "assign-close-put-30",
        tradeDate: "2026-02-20",
        symbol: "QZBE  260220P00030000",
        underlying: "QZBE",
        strike: 30,
        expiry: new Date("2026-02-20"),
        right: "P",
        buySell: "BUY",
        openClose: "C",
        quantity: 1,
        proceeds: 0,
      }),
      // Second CSP while holding shares, assigned at $21.50
      makeTrade({
        id: "open-put-21.5",
        tradeDate: "2026-03-23",
        symbol: "QZBE  260327P00021500",
        underlying: "QZBE",
        strike: 21.5,
        expiry: new Date("2026-03-27"),
        right: "P",
        buySell: "SELL",
        openClose: "O",
        quantity: -1,
        tradePrice: 0.35,
        proceeds: 35,
        wasAssigned: true,
      }),
      makeTrade({
        id: "assign-stock-21.5",
        tradeDate: "2026-03-27",
        symbol: "QZBE",
        underlying: "QZBE",
        secType: "STK",
        buySell: "BUY",
        openClose: "O",
        quantity: 100,
        tradePrice: 21.5,
        proceeds: -2150,
      }),
      makeTrade({
        id: "assign-close-put-21.5",
        tradeDate: "2026-03-27",
        symbol: "QZBE  260327P00021500",
        underlying: "QZBE",
        strike: 21.5,
        expiry: new Date("2026-03-27"),
        right: "P",
        buySell: "BUY",
        openClose: "C",
        quantity: 1,
        proceeds: 0,
      }),
      // Covered calls on both lots, assigned (called away) at $26
      makeTrade({
        id: "open-call-26",
        tradeDate: "2026-05-18",
        symbol: "QZBE  260529C00026000",
        underlying: "QZBE",
        strike: 26,
        expiry: new Date("2026-05-29"),
        right: "C",
        buySell: "SELL",
        openClose: "O",
        quantity: -2,
        tradePrice: 0.55,
        proceeds: 110,
        wasAssigned: true,
      }),
      makeTrade({
        id: "called-away-stock",
        tradeDate: "2026-05-29",
        symbol: "QZBE",
        underlying: "QZBE",
        secType: "STK",
        buySell: "SELL",
        openClose: "C",
        quantity: -200,
        tradePrice: 26,
        proceeds: 5200,
      }),
      makeTrade({
        id: "assign-close-call-26",
        tradeDate: "2026-05-29",
        symbol: "QZBE  260529C00026000",
        underlying: "QZBE",
        strike: 26,
        expiry: new Date("2026-05-29"),
        right: "C",
        buySell: "BUY",
        openClose: "C",
        quantity: 2,
        proceeds: 0,
      }),
    ];

    const assignedOptions = [
      { expiry: new Date("2026-02-20"), strike: 30, right: "P", tradeDate: new Date("2026-01-30") },
      { expiry: new Date("2026-03-27"), strike: 21.5, right: "P", tradeDate: new Date("2026-03-23") },
      { expiry: new Date("2026-05-29"), strike: 26, right: "C", tradeDate: new Date("2026-05-18") },
    ];

    const cycles = await wheelService.reconstructCycles(
      "QZBE",
      null,
      [],
      undefined,
      { dbTrades: trades as never, assignedOptions }
    );

    expect(cycles).toHaveLength(1);
    const cycle = cycles[0];
    expect(cycle.status).toBe("called_away");
    expect(cycle.startDate).toBe("2026-01-30");
    expect(cycle.endDate).toBe("2026-05-29");

    // Premiums: 30 + 35 + 110 = 175
    // Stock P&L: (26-30)*100 + (26-21.5)*100 = -400 + 450 = +50
    expect(cycle.realizedPnL).toBeCloseTo(225, 1);

    // Capital deployed: both lots' cost (3000 + 2150) minus premiums received
    // by then (30 + 35) — the second assignment must accumulate, not overwrite.
    expect(cycle.capitalDeployed).toBeCloseTo(5085, 1);
  });

  // Regression for the QZAC cycle-1 orphan: the close-before-open same-day sort
  // moved a same-contract buyback BEFORE the SOLD-PUT that should have started
  // the cycle. The buyback then ran while currentCycle was still null and was
  // silently dropped, inflating realized P&L by the buyback cost ($65 in the
  // real data). The pre-pair pass must keep open→close order for same-day
  // same-contract pairs while still placing roll-style closes before opens
  // (different contracts).
  it("keeps same-day same-contract open+close in one cycle (no orphan)", async () => {
    const trades: RawTradeShape[] = [
      // Cycle-starter: sold on Nov 18 expiring Jan 2 (still open after Nov 18)
      makeTrade({
        id: "open-put-65",
        tradeDate: "2025-11-18",
        symbol: "QZAC  260102P00065000",
        strike: 65,
        expiry: new Date("2026-01-02"),
        right: "P",
        buySell: "SELL",
        openClose: "O",
        quantity: -1,
        tradePrice: 3.64,
        proceeds: 364,
        commission: -1.05,
      }),
      // Same-day open + buyback of a different strike — this pair must be
      // preserved as (open, close) so the buyback lands in cycle 1.
      makeTrade({
        id: "open-put-75",
        tradeDate: "2025-11-18",
        symbol: "QZAC  251121P00075000",
        strike: 75,
        expiry: new Date("2025-11-21"),
        right: "P",
        buySell: "SELL",
        openClose: "O",
        quantity: -1,
        tradePrice: 1.15,
        proceeds: 115,
        commission: -0.05,
      }),
      makeTrade({
        id: "close-put-75",
        tradeDate: "2025-11-18",
        symbol: "QZAC  251121P00075000",
        strike: 75,
        expiry: new Date("2025-11-21"),
        right: "P",
        buySell: "BUY",
        openClose: "C",
        quantity: 1,
        tradePrice: 0.65,
        proceeds: -65,
        commission: -0.05,
      }),
      // Close the cycle-starter Dec 1
      makeTrade({
        id: "close-put-65",
        tradeDate: "2025-12-01",
        symbol: "QZAC  260102P00065000",
        strike: 65,
        expiry: new Date("2026-01-02"),
        right: "P",
        buySell: "BUY",
        openClose: "C",
        quantity: 1,
        tradePrice: 1.15,
        proceeds: -115,
        commission: -0.01,
      }),
    ];

    const cycles = await wheelService.reconstructCycles(
      "QZAC",
      null,
      [],
      undefined,
      { dbTrades: trades as never, assignedOptions: [] }
    );

    expect(cycles).toHaveLength(1);
    const cycle = cycles[0];

    // Cycle starts on the 65 PUT, not the 75 PUT — the pre-pair pass moves the
    // 75 close after its 75 open, leaving the 65 open as the cycle's first trade.
    expect(cycle.startDate).toBe("2025-11-18");
    expect(cycle.endDate).toBe("2025-12-01");
    expect(cycle.entryDescription).toBe("Sold PUT $65");

    // Realized P&L must reflect both buybacks: 362.95 + 114.95 - 65.05 - 115.01 ≈ 297.84.
    // Previously the 75 buyback was orphaned, giving 362.89 (overstated by $65).
    expect(cycle.realizedPnL).toBeCloseTo(297.84, 1);
  });
});

// Regression for the QZCI split bug: when only an *option* contract is held
// through a stock split, IBKR's corporate-action row stores the OCC option
// symbol (e.g. "QZCI  260618P00025000") in the `symbol` field and the
// underlying only appears at the front of the description ("QZCI(...) SPLIT
// 5 FOR 1 ..."). Matching corporate actions by `symbol === underlying` misses
// those rows, so trades stay in pre-split terms while live IBKR positions are
// post-split — mixing before/after-split values on the Wheel page.
describe("normalizeSplitsForUnderlying — underlying matching", () => {
  const palOption = {
    symbol: "QZCI  260618P00025000",
    description: "QZCI(USZ100985263) SPLIT 5 FOR 1 (QZCI  260618P00025000, QZCI 18JUN26 25 P, )",
    exDate: new Date("2026-05-15"),
    splitRatio: 5,
  };

  it("matches an option-adjustment split whose symbol is the OCC option code", () => {
    const splits = normalizeSplitsForUnderlying("QZCI", [palOption]);
    expect(splits).toHaveLength(1);
    expect(splits[0].splitRatio).toBe(5);
    expect(splits[0].exDate.toISOString()).toBe(palOption.exDate.toISOString());
  });

  it("matches a plain stock split whose symbol is the underlying", () => {
    const qzfa = {
      symbol: "QZFA",
      description: "QZFA(USZ339079289) SPLIT 10 FOR 1 (QZFA, ACME STREAMING INC, USZ339079289)",
      exDate: new Date("2025-11-14"),
      splitRatio: 10,
    };
    const splits = normalizeSplitsForUnderlying("QZFA", [qzfa]);
    expect(splits).toHaveLength(1);
    expect(splits[0].splitRatio).toBe(10);
  });

  it("de-duplicates the stock row and per-contract option rows of one split event", () => {
    const stockRow = {
      symbol: "QZCI",
      description: "QZCI(USZ100985263) SPLIT 5 FOR 1 (QZCI, ACME PRECIOUS METALS, )",
      exDate: new Date("2026-05-15"),
      splitRatio: 5,
    };
    const splits = normalizeSplitsForUnderlying("QZCI", [stockRow, palOption]);
    expect(splits).toHaveLength(1);
    expect(splits[0].splitRatio).toBe(5);
  });

  it("does not match a different underlying that shares a prefix", () => {
    const other = {
      symbol: "QZCIX  260618P00025000",
      description: "QZCIX(USZ348674897) SPLIT 2 FOR 1 (QZCIX, OTHER, )",
      exDate: new Date("2026-05-15"),
      splitRatio: 2,
    };
    expect(normalizeSplitsForUnderlying("QZCI", [other])).toHaveLength(0);
  });

  it("skips rows without a parsable ratio", () => {
    const noRatio = {
      symbol: "QZCI  260618P00025000",
      description: "QZCI(USZ100985263) SPLIT 5 FOR 1 (...)",
      exDate: new Date("2026-05-15"),
      splitRatio: null,
    };
    expect(normalizeSplitsForUnderlying("QZCI", [noRatio])).toHaveLength(0);
  });
});
