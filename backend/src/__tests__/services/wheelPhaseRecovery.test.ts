import { describe, it, expect, vi, beforeEach } from "vitest";

// A shares-only wheel position (bought 500, sold 200, 300 left) with no open
// options — the shape that exposed the sticky-idle cache bug on QZDO.
const mocks = vi.hoisted(() => {
  const stockTrade = (id: string, date: string, quantity: number, proceeds: number) => ({
    id,
    tradeId: id,
    tradeDate: new Date(date),
    symbol: "QZDO",
    underlying: null,
    secType: "STK",
    strike: null,
    expiry: null,
    right: null,
    quantity,
    tradePrice: Math.abs(proceeds / quantity),
    proceeds,
    commission: 0,
    buySell: quantity > 0 ? "BUY" : "SELL",
    openClose: null,
    wasAssigned: false,
    multiplier: 1,
    costBasis: null,
    realizedPnl: null,
  });

  const trades = [
    stockTrade("t1", "2025-10-21", 500, -6415),
    stockTrade("t2", "2025-11-26", -100, 1308),
    stockTrade("t3", "2025-11-26", -100, 1308),
  ];

  return {
    trades,
    upsert: vi.fn(async () => ({})),
    cacheFindMany: vi.fn(async () => [] as unknown[]),
    tradeFindMany: vi.fn(async (args: { where?: { wasAssigned?: boolean } }) =>
      args?.where?.wasAssigned ? [] : trades
    ),
    tradeAggregate: vi.fn(async () => ({
      _count: { _all: 3 },
      _max: { tradeDate: new Date("2025-11-26") },
    })),
  };
});

vi.mock("../../db/index.js", () => ({
  prisma: {
    corporateAction: { findMany: vi.fn(async () => []) },
    cashTransaction: {
      findMany: vi.fn(async () => []),
      aggregate: vi.fn(async () => ({ _count: { _all: 0 }, _max: { transactionDate: null } })),
    },
    wheelTracker: {
      findMany: vi.fn(async () => [
        { symbol: "QZDO", startDate: null, createdAt: new Date("2026-08-10") },
      ]),
    },
    wheelSummaryCache: {
      findMany: mocks.cacheFindMany,
      upsert: mocks.upsert,
    },
    importedTrade: {
      findMany: mocks.tradeFindMany,
      aggregate: mocks.tradeAggregate,
    },
  },
}));

vi.mock("../../services/ibkr.js", () => ({
  ibkrService: {
    isConnected: () => false,
    getTodayTrades: vi.fn(async () => []),
    getPositions: vi.fn(async () => []),
  },
}));

vi.mock("../../services/quotes/index.js", () => ({
  quoteHub: { get: vi.fn(async () => new Map()) },
}));

import { wheelService, applyLiveDataToSummary } from "../../services/wheel.service.js";

const liveData = {
  positions: [
    {
      account: "U1",
      contract: { secType: "STK", symbol: "QZDO" },
      pos: 300,
      avgCost: 12.835022,
      marketPrice: 11.434,
      marketValue: 3430.2,
      unrealizedPnl: -420.31,
    },
  ],
  todayTrades: [],
  marketPrices: new Map([["QZDO", 11.434]]),
  optionPrices: new Map(),
  optionThetas: new Map(),
};

const noLiveData = {
  positions: [],
  todayTrades: [],
  marketPrices: new Map<string, number>(),
  optionPrices: new Map<string, number>(),
  optionThetas: new Map<string, number>(),
};

describe("wheel summary cache — shares-only ticker phase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recovers holding_shares when the cached summary went idle but IBKR reports the shares", async () => {
    const [summary] = await wheelService.getTrackedTickers(liveData as never);
    expect(summary.currentPhase).toBe("holding_shares");

    // Simulate the poisoned cache row: a summary persisted while TWS was down.
    const poisoned = {
      ...summary,
      currentPhase: "idle" as const,
      activePhases: [],
      shareQuantity: 0,
      positionAvgCost: null,
      currentPosition: null,
    };

    const recovered = applyLiveDataToSummary(poisoned, liveData as never);

    expect(recovered.currentPhase).toBe("holding_shares");
    expect(recovered.shareQuantity).toBe(300);
    expect(recovered.activePhases).toEqual(["holding_shares"]);
  });

  it("does not persist a rebuilt summary computed without live IBKR data", async () => {
    const [summary] = await wheelService.getTrackedTickers(noLiveData as never);

    // Without positions the phase is necessarily idle — that value must not
    // reach the cache, or it becomes the served truth until the next trade.
    expect(summary.currentPhase).toBe("idle");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("persists a rebuilt summary when live IBKR data is present", async () => {
    await wheelService.getTrackedTickers(liveData as never);

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
});
