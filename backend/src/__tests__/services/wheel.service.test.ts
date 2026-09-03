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

import { wheelService } from "../../services/wheel.service.js";

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
});
