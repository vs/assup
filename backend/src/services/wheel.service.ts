/**
 * Wheel Strategy Service
 * Handles cycle reconstruction, metrics calculation, and ticker suggestions
 */

import { SecType } from "@stoqey/ib";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/index.js";
import { ibkrService } from "./ibkr.js";
import type {
  WheelTracker,
  WheelTrade,
  WheelCycle,
  WheelTickerSummary,
  WheelTickerDetail,
  WheelSuggestion,
  WheelAggregateMetrics,
} from "@assup/shared";
import {
  groupOptionTrades,
  groupStockTradesForWheel,
  optionGroupToWheelMatchedTrade,
  stockGroupToWheelMatchedTrade,
  type OptionTradeInput,
  type StockTradeInput
} from "./tradeMatching.js";
import type { WheelMatchedTrade } from "@assup/shared";

/** Get current date at midnight in US Eastern timezone for DTE calculations */
function nowInET(): Date {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return new Date(s + "T00:00:00");
}

interface RawTrade {
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

interface PrefetchedTradeData {
  dbTrades: RawTrade[];
  assignedOptions: Array<{ expiry: Date | null; strike: number | null; right: string | null; tradeDate: Date }>;
}

const tradeSelect = {
  id: true,
  tradeId: true,
  tradeDate: true,
  symbol: true,
  underlying: true,
  secType: true,
  strike: true,
  expiry: true,
  right: true,
  quantity: true,
  tradePrice: true,
  proceeds: true,
  commission: true,
  buySell: true,
  openClose: true,
  wasAssigned: true,
  multiplier: true,
  costBasis: true,
  realizedPnl: true,
};

// Bump this version whenever the cycle reconstruction algorithm changes
// to automatically invalidate stale caches.
const WHEEL_CACHE_VERSION = 3;

const serializeSummary = (summary: WheelTickerSummary): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify({ ...summary, _cacheVersion: WHEEL_CACHE_VERSION })) as Prisma.InputJsonValue;

const parseSummary = (value: Prisma.JsonValue): WheelTickerSummary | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (obj._cacheVersion !== WHEEL_CACHE_VERSION) return null;
  return value as unknown as WheelTickerSummary;
};

let wheelSummaryCacheAvailable: boolean | null = null;

const isMissingTableError = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021";

const loadWheelSummaryCache = async (symbols: string[]) => {
  if (wheelSummaryCacheAvailable === false || symbols.length === 0) return [];
  try {
    const caches = await prisma.wheelSummaryCache.findMany({
      where: { symbol: { in: symbols } },
    });
    wheelSummaryCacheAvailable = true;
    return caches;
  } catch (err) {
    if (isMissingTableError(err)) {
      wheelSummaryCacheAvailable = false;
      return [];
    }
    throw err;
  }
};

const upsertWheelSummaryCache = async (data: {
  symbol: string;
  startDate: Date | null;
  tradeCount: number;
  lastTradeDate: Date | null;
  summary: WheelTickerSummary;
}) => {
  if (wheelSummaryCacheAvailable === false) return;
  try {
    await prisma.wheelSummaryCache.upsert({
      where: { symbol: data.symbol },
      create: {
        symbol: data.symbol,
        startDate: data.startDate,
        tradeCount: data.tradeCount,
        lastTradeDate: data.lastTradeDate,
        summary: serializeSummary(data.summary),
      },
      update: {
        startDate: data.startDate,
        tradeCount: data.tradeCount,
        lastTradeDate: data.lastTradeDate,
        summary: serializeSummary(data.summary),
        computedAt: new Date(),
      },
    });
    wheelSummaryCacheAvailable = true;
  } catch (err) {
    if (isMissingTableError(err)) {
      wheelSummaryCacheAvailable = false;
      return;
    }
    throw err;
  }
};

const dateKey = (value?: Date | null) =>
  value ? value.toISOString().split("T")[0] : null;

const buildTradeWhereClause = (symbol: string, startDate: Date | null) => {
  const whereClause: Record<string, unknown> = {
    OR: [
      { underlying: symbol },
      { symbol: symbol, secType: "STK" },
    ],
  };
  if (startDate) {
    whereClause.tradeDate = { gte: startDate };
  }
  return whereClause;
};

// Cached IBKR data to avoid redundant API calls
interface CachedIBKRData {
  positions: Array<{
    account: string;
    contract: { secType?: string; symbol?: string; right?: string; strike?: number; lastTradeDateOrContractMonth?: string };
    pos: number;
    avgCost: number;
    marketPrice?: number;
    marketValue?: number;
    unrealizedPnl?: number;
  }>;
  todayTrades: RawTrade[];
  marketPrices: Map<string, number>;
  optionPrices: Map<string, number>;  // key: "SYMBOL-STRIKE-EXPIRY-RIGHT" -> price per share
}

function buildActiveOptions(
  shortOptionPositions: CachedIBKRData["positions"]
): WheelTickerSummary["activeOptions"] {
  const puts = shortOptionPositions.filter((p) => p.contract.right === "P");
  const calls = shortOptionPositions.filter((p) => p.contract.right === "C");

  const parseExpiry = (p: CachedIBKRData["positions"][0]) => {
    const raw = p.contract.lastTradeDateOrContractMonth;
    if (!raw) return null;
    const d = new Date(raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8));
    return { date: d, formatted: d.toISOString().split("T")[0] };
  };

  const nearest = (list: typeof puts) => {
    let best: (typeof puts)[0] | null = null;
    let bestDate: Date | null = null;
    for (const p of list) {
      const parsed = parseExpiry(p);
      if (parsed && (!bestDate || parsed.date < bestDate)) {
        best = p;
        bestDate = parsed.date;
      }
    }
    if (!best || !bestDate) return null;
    const dte = Math.ceil((bestDate.getTime() - nowInET().getTime()) / (1000 * 60 * 60 * 24));
    return { strike: best.contract.strike!, expiry: bestDate.toISOString().split("T")[0], dte };
  };

  return {
    nearestPut: nearest(puts),
    nearestCall: nearest(calls),
    totalPutContracts: puts.reduce((sum, p) => sum + Math.abs(p.pos), 0),
    totalCallContracts: calls.reduce((sum, p) => sum + Math.abs(p.pos), 0),
  };
}

const applyLiveDataToSummary = (
  summary: WheelTickerSummary,
  cachedData?: CachedIBKRData
): WheelTickerSummary => {
  if (!cachedData) return summary;

  const positions = cachedData.positions ?? [];
  const symbol = summary.symbol;

  // Find ALL short option positions for this symbol (not just the first)
  const shortOptionPositions = positions.filter(
    (p) => p.contract.secType === "OPT" && p.contract.symbol === symbol && p.pos < 0
  );
  const hasShortPut = shortOptionPositions.some((p) => p.contract.right === "P");
  const hasShortCall = shortOptionPositions.some((p) => p.contract.right === "C");
  const stockPos = positions.find(
    (p) => p.contract.secType === "STK" && p.contract.symbol === symbol && p.pos > 0
  );

  // Show shares if: wheel cycle involves them, OR there's a CSP alongside stock
  const cachedHadShares = summary.currentPhase === "holding_shares" ||
    summary.currentPhase === "cc_open" ||
    (summary.activePhases && summary.activePhases.includes("holding_shares"));
  const wheelSharesHeld = stockPos && stockPos.pos % 100 === 0 &&
    (cachedHadShares || hasShortPut || hasShortCall);

  // Build active phases array
  const activePhases: ("csp_open" | "holding_shares" | "cc_open")[] = [];
  if (hasShortPut) activePhases.push("csp_open");
  if (wheelSharesHeld) activePhases.push("holding_shares");
  if (hasShortCall) activePhases.push("cc_open");

  const hasUncoveredShares = !!wheelSharesHeld && !hasShortCall;
  const liveShareQuantity = wheelSharesHeld ? stockPos.pos : 0;
  const positionAvgCost = wheelSharesHeld ? stockPos.avgCost : null;

  // Primary phase: prefer option positions, fallback to shares
  const optionPos = shortOptionPositions[0] ?? null;
  let currentPhase: WheelTickerSummary["currentPhase"] = "idle";
  let currentPosition: WheelTickerSummary["currentPosition"] = null;

  if (optionPos) {
    const isCall = optionPos.contract.right === "C";
    currentPhase = isCall ? "cc_open" : "csp_open";

    const expiry = optionPos.contract.lastTradeDateOrContractMonth;
    const expiryDate = expiry ? new Date(
      expiry.slice(0, 4) + "-" + expiry.slice(4, 6) + "-" + expiry.slice(6, 8)
    ) : null;
    const dte = expiryDate
      ? Math.ceil((expiryDate.getTime() - nowInET().getTime()) / (1000 * 60 * 60 * 24))
      : undefined;

    const costBasis = Math.abs(optionPos.pos * optionPos.avgCost);
    const unrealizedPnl = optionPos.marketValue !== undefined
      ? costBasis - Math.abs(optionPos.marketValue)
      : undefined;

    currentPosition = {
      type: isCall ? "cc" : "csp",
      strike: optionPos.contract.strike,
      expiry: expiryDate?.toISOString().split("T")[0],
      dte,
      quantity: Math.abs(optionPos.pos),
      unrealizedPnl,
    };
  } else if (wheelSharesHeld) {
    currentPhase = "holding_shares";
    const costBasis = stockPos.pos * stockPos.avgCost;
    const unrealizedPnl = stockPos.marketValue !== undefined
      ? stockPos.marketValue - costBasis
      : undefined;

    currentPosition = {
      type: "shares",
      quantity: stockPos.pos,
      unrealizedPnl,
    };
  }

  const adjustedCostBasis = summary.adjustedCostBasis;
  const currentPrice = cachedData.marketPrices.get(symbol) ?? summary.currentPrice ?? null;
  const breakEven = adjustedCostBasis;
  const percentBelowMarket = currentPrice && adjustedCostBasis > 0
    ? ((currentPrice - adjustedCostBasis) / currentPrice) * 100
    : null;

  let unrealizedPnL = 0;

  const shareQuantity = stockPos?.pos ?? 0;
  if (shareQuantity > 0 && currentPrice != null && adjustedCostBasis > 0) {
    unrealizedPnL += (currentPrice - adjustedCostBasis) * shareQuantity;
  }

  for (const pos of positions) {
    if (pos.contract.secType === "OPT" &&
        pos.contract.symbol === symbol &&
        pos.pos < 0 &&
        pos.unrealizedPnl != null) {
      unrealizedPnL += pos.unrealizedPnl;
    }
  }

  if (currentPhase === "idle") {
    unrealizedPnL = 0;
  }

  let capitalDeployed = summary.capitalDeployed;
  if (capitalDeployed === 0 && currentPosition) {
    if (currentPhase === "csp_open" && currentPosition.strike) {
      capitalDeployed = currentPosition.strike * 100 * currentPosition.quantity;
    } else if (currentPhase === "holding_shares" || currentPhase === "cc_open") {
      const quantity = currentPhase === "cc_open" ? shareQuantity : currentPosition.quantity;
      capitalDeployed = adjustedCostBasis * quantity;
    }
  }
  if (currentPhase === "idle") {
    capitalDeployed = 0;
  }

  const realizedPnL = summary.realizedPnL;
  const totalPnL = realizedPnL + unrealizedPnL;
  const realizedPnLPercent = capitalDeployed > 0
    ? (realizedPnL / capitalDeployed) * 100
    : null;
  const unrealizedPnLPercent = capitalDeployed > 0
    ? (unrealizedPnL / capitalDeployed) * 100
    : null;
  const totalPnLPercent = capitalDeployed > 0
    ? (totalPnL / capitalDeployed) * 100
    : null;

  return {
    ...summary,
    currentPhase,
    activePhases,
    hasUncoveredShares,
    shareQuantity: liveShareQuantity,
    positionAvgCost,
    currentPosition,
    activeOptions: buildActiveOptions(shortOptionPositions),
    currentPrice,
    breakEven,
    percentBelowMarket,
    unrealizedPnL,
    totalPnL,
    capitalDeployed,
    realizedPnLPercent,
    unrealizedPnLPercent,
    totalPnLPercent,
  };
};

export const wheelService = {
  /**
   * Fetch all IBKR data needed for wheel calculations in one batch
   */
  async fetchIBKRData(symbols: string[]): Promise<CachedIBKRData> {
    const result: CachedIBKRData = {
      positions: [],
      todayTrades: [],
      marketPrices: new Map(),
      optionPrices: new Map(),
    };

    if (!ibkrService.isConnected()) {
      return result;
    }

    try {
      // Fetch positions and today's trades in parallel
      const [positions, todayTrades] = await Promise.all([
        ibkrService.getPositions().catch(() => []),
        ibkrService.getTodayTrades().catch(() => []),
      ]);

      result.positions = positions;
      result.todayTrades = todayTrades as unknown as RawTrade[];

      const trackedSymbols = new Set(symbols);
      const symbolsNeedingPrice = new Set<string>();

      // Populate option prices from positions
      for (const pos of positions) {
        if (pos.contract.secType === "OPT" && pos.marketPrice != null) {
          const symbol = pos.contract.symbol;
          const strike = pos.contract.strike;
          const expiry = pos.contract.lastTradeDateOrContractMonth;
          const right = pos.contract.right;
          if (symbol && strike != null && expiry && right) {
            // Key format: "SYMBOL-STRIKE-EXPIRY-RIGHT" (e.g., "AAPL-150-20240315-C")
            const key = `${symbol}-${strike}-${expiry}-${right}`;
            result.optionPrices.set(key, pos.marketPrice);
          }
        }

        if (pos.pos !== 0) {
          const symbol = pos.contract.symbol;
          if (!symbol || !trackedSymbols.has(symbol)) continue;

          if (pos.contract.secType === "STK" && pos.marketPrice != null) {
            result.marketPrices.set(symbol, pos.marketPrice);
          } else {
            symbolsNeedingPrice.add(symbol);
          }
        }
      }

      // Fetch market prices only for active tracked symbols missing price data
      const priceSymbols = Array.from(symbolsNeedingPrice).filter(
        (symbol) => !result.marketPrices.has(symbol)
      );
      if (priceSymbols.length > 0) {
        const pricePromises = priceSymbols.map(async (symbol) => {
          try {
            const contract = {
              symbol,
              secType: SecType.STK,
              exchange: "SMART",
              currency: "USD",
            };
            const data = await ibkrService.getMarketData(contract);
            const price = data?.last ?? data?.close;
            if (price != null) {
              result.marketPrices.set(symbol, price);
            }
          } catch {
            // Skip symbols that fail to fetch
          }
        });
        await Promise.all(pricePromises);
      }
    } catch (err) {
      console.error("Failed to fetch IBKR data:", err);
    }

    return result;
  },

  /**
   * Get symbols for all tracked tickers
   */
  async getTrackerSymbols(): Promise<string[]> {
    const trackers = await prisma.wheelTracker.findMany({ select: { symbol: true } });
    return trackers.map(t => t.symbol);
  },

  /**
   * Get trade stats for cache validation
   */
  async getTradeStats(symbol: string, startDate: Date | null): Promise<{ tradeCount: number; lastTradeDate: Date | null }> {
    const stats = await prisma.importedTrade.aggregate({
      where: buildTradeWhereClause(symbol, startDate),
      _count: { _all: true },
      _max: { tradeDate: true },
    });

    return {
      tradeCount: stats._count._all,
      lastTradeDate: stats._max.tradeDate,
    };
  },

  /**
   * Get all tracked tickers with summary data
   */
  async getTrackedTickers(cachedData?: CachedIBKRData): Promise<WheelTickerSummary[]> {
    const trackers = await prisma.wheelTracker.findMany({
      orderBy: { createdAt: "desc" },
    });

    if (trackers.length === 0) return [];

    const symbols = trackers.map(t => t.symbol);

    const [ibkrData, caches] = await Promise.all([
      cachedData ?? this.fetchIBKRData(symbols),
      loadWheelSummaryCache(symbols),
    ]);

    const cacheBySymbol = new Map(caches.map(c => [c.symbol, c]));

    const tradeStatsEntries = await Promise.all(
      trackers.map(async (tracker) => {
        const stats = await this.getTradeStats(tracker.symbol, tracker.startDate);
        return [tracker.symbol, stats] as const;
      })
    );
    const tradeStatsBySymbol = new Map(tradeStatsEntries);

    // Index today's trades by symbol to detect new activity
    const todayTradesBySymbol = new Map<string, RawTrade[]>();
    for (const trade of ibkrData.todayTrades as RawTrade[]) {
      const sym = trade.underlying || trade.symbol;
      if (!sym) continue;
      if (!todayTradesBySymbol.has(sym)) todayTradesBySymbol.set(sym, []);
      todayTradesBySymbol.get(sym)!.push(trade);
    }

    const rebuildSymbols = new Set<string>();
    for (const tracker of trackers) {
      const cache = cacheBySymbol.get(tracker.symbol);
      const stats = tradeStatsBySymbol.get(tracker.symbol);
      const hasTodayTrades = (todayTradesBySymbol.get(tracker.symbol)?.length ?? 0) > 0;
      const cacheValid = cache &&
        parseSummary(cache.summary as Prisma.JsonValue) !== null &&
        dateKey(cache.startDate) === dateKey(tracker.startDate) &&
        stats &&
        cache.tradeCount === stats.tradeCount &&
        dateKey(cache.lastTradeDate) === dateKey(stats.lastTradeDate) &&
        !hasTodayTrades;

      if (!cacheValid) {
        rebuildSymbols.add(tracker.symbol);
      }
    }

    // Prefetch trades only for symbols that need recomputation
    const tradesBySymbol = new Map<string, RawTrade[]>();
    const assignedBySymbol = new Map<string, Array<{ expiry: Date | null; strike: number | null; right: string | null; tradeDate: Date }>>();

    if (rebuildSymbols.size > 0) {
      const symbolsToFetch = Array.from(rebuildSymbols);
      const [allDbTrades, allAssignedOptions] = await Promise.all([
        prisma.importedTrade.findMany({
          where: {
            OR: [
              { underlying: { in: symbolsToFetch } },
              { symbol: { in: symbolsToFetch }, secType: "STK" },
            ],
          },
          orderBy: { tradeDate: "asc" },
          select: tradeSelect,
        }),
        prisma.importedTrade.findMany({
          where: {
            underlying: { in: symbolsToFetch },
            secType: "OPT",
            wasAssigned: true,
          },
          select: {
            underlying: true,
            expiry: true,
            strike: true,
            right: true,
            tradeDate: true,
          },
        }),
      ]);

      for (const trade of allDbTrades as unknown as RawTrade[]) {
        const sym = trade.underlying || trade.symbol;
        if (!tradesBySymbol.has(sym)) tradesBySymbol.set(sym, []);
        tradesBySymbol.get(sym)!.push(trade);
      }

      for (const opt of allAssignedOptions) {
        const sym = opt.underlying!;
        if (!assignedBySymbol.has(sym)) assignedBySymbol.set(sym, []);
        assignedBySymbol.get(sym)!.push(opt);
      }
    }

    const summaries = await Promise.all(
      trackers.map(async (tracker) => {
        if (!rebuildSymbols.has(tracker.symbol)) {
          const cache = cacheBySymbol.get(tracker.symbol);
          if (cache && cache.summary) {
            const cachedSummary = parseSummary(cache.summary as Prisma.JsonValue);
            if (cachedSummary) {
              return applyLiveDataToSummary(cachedSummary, ibkrData);
            }
          }
        }

        let symbolTrades = tradesBySymbol.get(tracker.symbol) || [];
        if (tracker.startDate) {
          const startMs = tracker.startDate.getTime();
          symbolTrades = symbolTrades.filter(t => new Date(t.tradeDate).getTime() >= startMs);
        }

        const prefetched: PrefetchedTradeData = {
          dbTrades: symbolTrades,
          assignedOptions: assignedBySymbol.get(tracker.symbol) || [],
        };

        const summary = await this.getTickerSummary(tracker.symbol, tracker.startDate, ibkrData, prefetched);
        const stats = tradeStatsBySymbol.get(tracker.symbol);
        if (stats) {
          await upsertWheelSummaryCache({
            symbol: tracker.symbol,
            startDate: tracker.startDate,
            tradeCount: stats.tradeCount,
            lastTradeDate: stats.lastTradeDate,
            summary,
          });
        }

        return summary;
      })
    );

    // Sort: active positions first, then by most recent activity
    return summaries.sort((a, b) => {
      const aActive = a.currentPhase !== "idle" ? 1 : 0;
      const bActive = b.currentPhase !== "idle" ? 1 : 0;
      return bActive - aActive;
    });
  },

  /**
   * Get detailed view for a single ticker
   */
  async getTickerDetail(symbol: string): Promise<WheelTickerDetail | null> {
    const tracker = await prisma.wheelTracker.findUnique({
      where: { symbol },
    });

    if (!tracker) return null;

    // Fetch IBKR data once
    const ibkrData = await this.fetchIBKRData([symbol]);

    // Get cycles first, then pass to summary to avoid duplicate reconstruction
    const cycles = await this.reconstructCycles(symbol, tracker.startDate, ibkrData.todayTrades, ibkrData);
    const summary = await this.getTickerSummaryWithCycles(symbol, tracker.startDate, cycles, ibkrData);

    return { ...summary, cycles };
  },

  /**
   * Get ticker summary with current state and metrics
   * Uses cached IBKR data to avoid redundant API calls
   */
  async getTickerSummary(symbol: string, startDate: Date | null, cachedData?: CachedIBKRData, prefetchedData?: PrefetchedTradeData): Promise<WheelTickerSummary> {
    const todayTrades = cachedData?.todayTrades ?? [];
    const cycles = await this.reconstructCycles(symbol, startDate, todayTrades, cachedData, prefetchedData);
    return this.getTickerSummaryWithCycles(symbol, startDate, cycles, cachedData);
  },

  /**
   * Get ticker summary with pre-computed cycles (avoids duplicate cycle reconstruction)
   */
  async getTickerSummaryWithCycles(
    symbol: string,
    startDate: Date | null,
    cycles: WheelCycle[],
    cachedData?: CachedIBKRData
  ): Promise<WheelTickerSummary> {
    const completedCycles = cycles.filter((c) => c.status !== "in_progress");
    const currentCycle = cycles.find((c) => c.status === "in_progress");

    // Calculate totals
    const totalPremiums = cycles.reduce((sum, c) => sum + c.totalPremium, 0);

    // Use cached positions or empty array
    const positions = cachedData?.positions ?? [];

    // Find ALL short option positions for this symbol
    const shortOptionPositions = positions.filter(
      (p) => p.contract.secType === "OPT" && p.contract.symbol === symbol && p.pos < 0
    );
    const hasShortPut = shortOptionPositions.some((p) => p.contract.right === "P");
    const hasShortCall = shortOptionPositions.some((p) => p.contract.right === "C");
    const stockPos = positions.find(
      (p) => p.contract.secType === "STK" && p.contract.symbol === symbol && p.pos > 0
    );

    // Show shares if: wheel cycle involves them, OR there's an option alongside stock
    const wheelSharesHeld = stockPos && stockPos.pos % 100 === 0 &&
      ((currentCycle && currentCycle.shareQuantity > 0) || hasShortPut || hasShortCall);

    // Build active phases array
    const activePhases: ("csp_open" | "holding_shares" | "cc_open")[] = [];
    if (hasShortPut) activePhases.push("csp_open");
    if (wheelSharesHeld) activePhases.push("holding_shares");
    if (hasShortCall) activePhases.push("cc_open");

    const hasUncoveredShares = !!wheelSharesHeld && !hasShortCall;
    const liveShareQuantity = wheelSharesHeld ? stockPos.pos : 0;
    const positionAvgCost = wheelSharesHeld ? stockPos.avgCost : null;

    const optionPos = shortOptionPositions[0] ?? null;
    let currentPhase: WheelTickerSummary["currentPhase"] = "idle";
    let currentPosition: WheelTickerSummary["currentPosition"] = null;

    if (optionPos) {
      const isCall = optionPos.contract.right === "C";
      currentPhase = isCall ? "cc_open" : "csp_open";

      const expiry = optionPos.contract.lastTradeDateOrContractMonth;
      const expiryDate = expiry ? new Date(
        expiry.slice(0, 4) + "-" + expiry.slice(4, 6) + "-" + expiry.slice(6, 8)
      ) : null;
      const dte = expiryDate
        ? Math.ceil((expiryDate.getTime() - nowInET().getTime()) / (1000 * 60 * 60 * 24))
        : undefined;

      // Calculate unrealized P&L from market value and cost basis
      const costBasis = Math.abs(optionPos.pos * optionPos.avgCost);
      const unrealizedPnl = optionPos.marketValue !== undefined
        ? costBasis - Math.abs(optionPos.marketValue)
        : undefined;

      currentPosition = {
        type: isCall ? "cc" : "csp",
        strike: optionPos.contract.strike,
        expiry: expiryDate?.toISOString().split("T")[0],
        dte,
        quantity: Math.abs(optionPos.pos),
        unrealizedPnl,
      };
    } else if (wheelSharesHeld) {
      currentPhase = "holding_shares";
      const costBasis = stockPos.pos * stockPos.avgCost;
      const unrealizedPnl = stockPos.marketValue !== undefined
        ? stockPos.marketValue - costBasis
        : undefined;

      currentPosition = {
        type: "shares",
        quantity: stockPos.pos,
        unrealizedPnl,
      };
    }

    // Calculate adjusted cost basis
    // Start with the actual cost basis source, subtract all premiums collected
    let adjustedCostBasis = 0;

    if (currentCycle) {
      const hasAssignment = currentCycle.trades.some((t) => t.status === "assigned");
      if (hasAssignment) {
        // Shares were assigned through the wheel - use assignment price adjusted by premiums
        adjustedCostBasis = currentCycle.entryStrike - (currentCycle.totalPremium / (currentCycle.shareQuantity || 100));
      } else if (positionAvgCost !== null && wheelSharesHeld) {
        // Shares held from before this cycle (e.g. bought long ago, now selling CCs)
        // Use actual IBKR cost basis, not the call strike
        const shares = currentCycle.shareQuantity || liveShareQuantity || 100;
        adjustedCostBasis = positionAvgCost - (currentCycle.totalPremium / shares);
      } else {
        // CSP phase - no shares yet, use put strike as potential cost basis
        adjustedCostBasis = currentCycle.entryStrike - (currentCycle.totalPremium / 100);
      }
    }

    // Get current price from cached market data
    const currentPrice = cachedData?.marketPrices.get(symbol) ?? null;

    const breakEven = adjustedCostBasis;
    const percentBelowMarket = currentPrice && adjustedCostBasis > 0
      ? ((currentPrice - adjustedCostBasis) / currentPrice) * 100
      : null;

    // Aggregate P&L from all cycles
    let tickerRealizedPnL = 0;
    let tickerUnrealizedPnL = 0;
    let tickerCapitalDeployed = 0;

    for (const cycle of cycles) {
      tickerRealizedPnL += cycle.realizedPnL;
      if (cycle.unrealizedPnL != null) {
        tickerUnrealizedPnL += cycle.unrealizedPnL;
      }
      // For capital deployed, use max of current or in-progress cycle
      if (cycle.status === "in_progress") {
        tickerCapitalDeployed = cycle.capitalDeployed;
      }
    }

    // If no in-progress cycle, use current position's capital
    if (tickerCapitalDeployed === 0 && currentPosition) {
      if (currentPhase === "csp_open" && currentPosition.strike) {
        tickerCapitalDeployed = currentPosition.strike * 100 * currentPosition.quantity;
      } else if (currentPhase === "holding_shares" || currentPhase === "cc_open") {
        tickerCapitalDeployed = adjustedCostBasis * currentPosition.quantity;
      }
    }

    const totalPnL = tickerRealizedPnL + tickerUnrealizedPnL;
    const realizedPnLPercent = tickerCapitalDeployed > 0
      ? (tickerRealizedPnL / tickerCapitalDeployed) * 100
      : null;
    const unrealizedPnLPercent = tickerCapitalDeployed > 0
      ? (tickerUnrealizedPnL / tickerCapitalDeployed) * 100
      : null;
    const totalPnLPercent = tickerCapitalDeployed > 0
      ? (totalPnL / tickerCapitalDeployed) * 100
      : null;

    return {
      symbol,
      currentPhase,
      activePhases,
      hasUncoveredShares,
      shareQuantity: liveShareQuantity,
      positionAvgCost,
      adjustedCostBasis,
      totalPremiums,
      currentPrice,
      breakEven,
      percentBelowMarket,
      cycleCount: cycles.length,
      completedCycles: completedCycles.length,
      currentPosition,
      activeOptions: buildActiveOptions(shortOptionPositions),
      realizedPnL: tickerRealizedPnL,
      unrealizedPnL: tickerUnrealizedPnL,
      totalPnL,
      capitalDeployed: tickerCapitalDeployed,
      realizedPnLPercent,
      unrealizedPnLPercent,
      totalPnLPercent,
    };
  },

  /**
   * Filter cached today's trades for a specific symbol
   */
  filterTodayTradesForSymbol(allTrades: RawTrade[], symbol: string): RawTrade[] {
    return allTrades.filter(t =>
      t.underlying === symbol || t.symbol === symbol
    );
  },

  /**
   * Match trades within a cycle into WheelMatchedTrade format
   */
  matchTradesForCycle(trades: RawTrade[], symbol: string): WheelMatchedTrade[] {
    // Separate options and stocks
    const optionTrades = trades.filter(t => t.secType === "OPT") as unknown as OptionTradeInput[];
    const stockTrades = trades.filter(t => t.secType === "STK") as unknown as StockTradeInput[];

    // Use shared grouping logic
    const optionGroups = groupOptionTrades(optionTrades);
    const stockGroups = groupStockTradesForWheel(stockTrades);

    // Convert to WheelMatchedTrade format
    const result: WheelMatchedTrade[] = [
      ...optionGroups.map(g => optionGroupToWheelMatchedTrade(g, symbol)),
      ...stockGroups.map(g => stockGroupToWheelMatchedTrade(g)),
    ];

    // Sort by date (open leg date)
    return result.sort((a, b) => {
      const dateA = a.openLeg?.date || a.closeLeg?.date || "";
      const dateB = b.openLeg?.date || b.closeLeg?.date || "";
      return dateA.localeCompare(dateB);
    });
  },

  /**
   * Reconstruct wheel cycles from trade history
   * A cycle = any period where position (shares + options) is non-zero
   * @param cachedTodayTrades - Pre-fetched today's trades to avoid redundant API calls
   * @param cachedData - Pre-fetched IBKR data for unrealized P&L calculation
   */
  async reconstructCycles(symbol: string, startDate: Date | null, cachedTodayTrades?: RawTrade[], cachedData?: CachedIBKRData, prefetchedData?: PrefetchedTradeData): Promise<WheelCycle[]> {
    let dbTrades: RawTrade[];
    let assignedOptions: Array<{ expiry: Date | null; strike: number | null; right: string | null; tradeDate: Date }>;

    if (prefetchedData) {
      // Use pre-fetched data from batch query
      dbTrades = prefetchedData.dbTrades;
      assignedOptions = prefetchedData.assignedOptions;
    } else {
      // Fetch both queries in parallel
      const whereClause = buildTradeWhereClause(symbol, startDate);

      const [fetchedTrades, fetchedAssigned] = await Promise.all([
        prisma.importedTrade.findMany({
          where: whereClause,
          orderBy: { tradeDate: "asc" },
          select: tradeSelect,
        }),
        prisma.importedTrade.findMany({
          where: {
            underlying: symbol,
            secType: "OPT",
            wasAssigned: true,
          },
          select: {
            expiry: true,
            strike: true,
            right: true,
            tradeDate: true,
          },
        }),
      ]);

      dbTrades = fetchedTrades as RawTrade[];
      assignedOptions = fetchedAssigned;
    }

    // Use cached today's executions or fetch if not provided
    let todayExecutions: RawTrade[];
    if (cachedTodayTrades) {
      todayExecutions = this.filterTodayTradesForSymbol(cachedTodayTrades, symbol);
    } else {
      const allTrades = await ibkrService.getTodayTrades().catch(() => []);
      todayExecutions = this.filterTodayTradesForSymbol(allTrades as unknown as RawTrade[], symbol);
    }

    // Deduplicate by tradeId to avoid showing same trade twice
    const existingTradeIds = new Set(
      dbTrades.map(t => (t as unknown as { tradeId?: string }).tradeId).filter(Boolean)
    );
    const newExecutions = todayExecutions.filter(
      t => !(t as unknown as { tradeId?: string }).tradeId ||
           !existingTradeIds.has((t as unknown as { tradeId?: string }).tradeId!)
    );

    // Merge and sort by date with deterministic intra-day ordering:
    // 1. STK before OPT (assignment stock delivery before option close)
    // 2. Within OPT: closes before opens (so rolling properly ends one cycle and starts another)
    const trades = [...dbTrades, ...newExecutions].sort((a, b) => {
      const dateA = new Date(a.tradeDate).getTime();
      const dateB = new Date(b.tradeDate).getTime();
      if (dateA !== dateB) return dateA - dateB;
      // Same day: STK before OPT (assignment stock delivery before option close)
      if (a.secType === "STK" && b.secType === "OPT") return -1;
      if (a.secType === "OPT" && b.secType === "STK") return 1;
      // Same day, both OPT: close before open (enables cycle boundary detection on rolls)
      if (a.secType === "OPT" && b.secType === "OPT") {
        const aIsClose = a.openClose === "C";
        const bIsClose = b.openClose === "C";
        if (aIsClose && !bIsClose) return -1;
        if (!aIsClose && bIsClose) return 1;
      }
      return 0;
    });

    // Record original stock trade quantities before split adjustment
    // Used to filter out non-wheel stock trades (hold strategy buys/sells)
    const originalStockQty = new Map<RawTrade, number>();
    for (const trade of trades) {
      if (trade.secType === "STK") {
        originalStockQty.set(trade, Math.abs(trade.quantity));
      }
    }

    // Adjust trades for stock splits to normalize all values to post-split terms
    const splits = await prisma.corporateAction.findMany({
      where: {
        symbol,
        actionType: { in: ["FS", "SD"] },
        splitRatio: { not: null },
      },
      orderBy: { exDate: "asc" },
    });

    if (splits.length > 0) {
      const getSplitMultiplier = (tradeDate: Date): number => {
        let multiplier = 1;
        for (const split of splits) {
          if (split.exDate > tradeDate && split.splitRatio) {
            multiplier *= split.splitRatio;
          }
        }
        return multiplier;
      };

      for (const trade of trades) {
        const multiplier = getSplitMultiplier(trade.tradeDate);
        if (multiplier !== 1) {
          trade.quantity = trade.quantity * multiplier;
          trade.tradePrice = trade.tradePrice / multiplier;
          if (trade.strike) {
            trade.strike = trade.strike / multiplier;
          }
        }
      }

      for (const opt of assignedOptions) {
        if (opt.strike) {
          const multiplier = getSplitMultiplier(opt.tradeDate);
          if (multiplier !== 1) {
            opt.strike = opt.strike / multiplier;
          }
        }
      }
    }

    // Filter out non-wheel stock trades (hold strategy buys/sells).
    // A stock trade is considered a wheel trade if:
    // - it's an assignment (wasAssigned=true), OR
    // - its original (pre-split-adjustment) quantity is a multiple of 100, OR
    // - its post-split-adjusted quantity is a multiple of 100 (e.g., 10 shares pre-split → 100 post-split)
    const filteredTrades = trades.filter(trade => {
      if (trade.secType !== "STK") return true;
      if (trade.wasAssigned) return true;
      const origQty = originalStockQty.get(trade) ?? Math.abs(trade.quantity);
      if (origQty % 100 === 0) return true;
      return Math.abs(trade.quantity) % 100 === 0;
    });

    // Build lookup maps for assigned PUTs and CALLs
    // Key: "YYYY-MM-DD:strike" -> true
    const assignedPuts = new Map<string, boolean>();
    const assignedCalls = new Map<string, boolean>();
    for (const opt of assignedOptions) {
      if (!opt.expiry || !opt.strike) continue;
      const key = `${opt.expiry.toISOString().split("T")[0]}:${opt.strike}`;
      if (opt.right === "P") {
        assignedPuts.set(key, true);
      } else if (opt.right === "C") {
        assignedCalls.set(key, true);
      }
    }

    // Generate synthetic expiration trades for options that expired without a close
    // trade record (IBKR doesn't generate trade records for worthless expirations).
    // Without these, optionPosition gets stuck and cycles never properly end.
    const openOptionLegs = new Map<string, { qty: number; expiry: Date; right: string; strike: number; symbol: string; underlying: string | null }>();
    for (const trade of filteredTrades) {
      if (trade.secType !== "OPT" || !trade.expiry || !trade.strike || !trade.right) continue;
      const key = `${trade.right}:${trade.strike}:${trade.expiry.toISOString().split("T")[0]}`;
      if (trade.buySell === "SELL") {
        const existing = openOptionLegs.get(key);
        if (existing) {
          existing.qty += Math.abs(trade.quantity);
        } else {
          openOptionLegs.set(key, {
            qty: Math.abs(trade.quantity),
            expiry: trade.expiry,
            right: trade.right,
            strike: trade.strike,
            symbol: trade.symbol,
            underlying: trade.underlying,
          });
        }
      } else if (trade.buySell === "BUY") {
        const existing = openOptionLegs.get(key);
        if (existing) {
          existing.qty -= Math.abs(trade.quantity);
          if (existing.qty <= 0) openOptionLegs.delete(key);
        }
      }
    }

    const now = new Date();
    let syntheticCount = 0;
    for (const [, leg] of openOptionLegs) {
      if (leg.qty <= 0 || leg.expiry >= now) continue;
      // Don't generate expiration for assigned options (they have stock trades instead)
      const expiryStr = leg.expiry.toISOString().split("T")[0];
      const assignedKey = `${expiryStr}:${leg.strike}`;
      const wasAssigned = (leg.right === "P" && assignedPuts.has(assignedKey)) ||
                          (leg.right === "C" && assignedCalls.has(assignedKey));
      if (wasAssigned) continue;

      filteredTrades.push({
        id: `synthetic-exp-${syntheticCount++}`,
        tradeDate: leg.expiry,
        symbol: leg.symbol,
        underlying: leg.underlying,
        secType: "OPT",
        strike: leg.strike,
        expiry: leg.expiry,
        right: leg.right,
        quantity: leg.qty,
        tradePrice: 0,
        proceeds: 0,
        commission: 0,
        buySell: "BUY",
        openClose: "C",
        wasAssigned: false,
        multiplier: 100,
        costBasis: null,
        realizedPnl: null,
      });
    }

    // Re-sort after adding synthetic trades
    if (syntheticCount > 0) {
      filteredTrades.sort((a, b) => {
        const dateA = new Date(a.tradeDate).getTime();
        const dateB = new Date(b.tradeDate).getTime();
        if (dateA !== dateB) return dateA - dateB;
        if (a.secType === "STK" && b.secType === "OPT") return -1;
        if (a.secType === "OPT" && b.secType === "STK") return 1;
        if (a.secType === "OPT" && b.secType === "OPT") {
          const aIsClose = a.openClose === "C";
          const bIsClose = b.openClose === "C";
          if (aIsClose && !bIsClose) return -1;
          if (!aIsClose && bIsClose) return 1;
        }
        return 0;
      });
    }

    // Helper to find matching assigned option for a stock trade
    // Returns { strike, expiry } if assignment found, null otherwise
    const findAssignedOption = (trade: RawTrade, type: "PUT" | "CALL"): { strike: number; expiry: string } | null => {
      // Check the old wasAssigned field first (for backward compat with test data)
      if (trade.wasAssigned && trade.strike) {
        return { strike: trade.strike, expiry: trade.expiry?.toISOString().split("T")[0] || trade.tradeDate.toISOString().split("T")[0] };
      }

      // Check against assigned options lookup
      const tradeDate = trade.tradeDate.toISOString().split("T")[0];
      if (trade.quantity === 0) return null;
      const tradePrice = Math.abs(trade.proceeds / trade.quantity);

      // Look for matching assigned option (date within 5 days, price within 2% of strike)
      const map = type === "PUT" ? assignedPuts : assignedCalls;
      for (const [key] of map) {
        const [expiry, strikeStr] = key.split(":");
        const strike = parseFloat(strikeStr);

        // Check date proximity (assignment can happen around expiry)
        const expiryDate = new Date(expiry);
        const tradeDateObj = new Date(tradeDate);
        const daysDiff = Math.abs((tradeDateObj.getTime() - expiryDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff > 5) continue;

        // Check price proximity (within 2% of strike)
        const priceDiff = Math.abs(tradePrice - strike) / strike;
        if (priceDiff < 0.02) return { strike, expiry };
      }
      return null;
    };

    const cycles: WheelCycle[] = [];
    let currentCycle: WheelCycle | null = null;
    let cycleTradeIndices: number[] = []; // Track which raw trade indices belong to current cycle
    let sharePosition = 0;
    let optionPosition = 0; // positive = short options (sold contracts)
    let cycleNumber = 0;
    let runningCostBasis = 0;

    // P&L tracking variables
    let cycleRealizedPnL = 0;
    let cycleCapitalDeployed = 0;
    let cyclePremiumReceived = 0; // Track total premium for capital calculation

    for (let tradeIdx = 0; tradeIdx < filteredTrades.length; tradeIdx++) {
      const trade = filteredTrades[tradeIdx];
      const isOption = trade.secType === "OPT";
      const isStock = trade.secType === "STK";
      const isSell = trade.buySell === "SELL";
      const isBuy = trade.buySell === "BUY";
      const isPut = trade.right === "P";
      const isCall = trade.right === "C";

      const prevTotalPosition = sharePosition + optionPosition * 100;

      // Determine trade type and update positions
      let tradeType: WheelTrade["type"] | null = null;
      let isWheelTrade = true;
      let assignedOptionInfo: { strike: number; expiry: string } | null = null;

      if (isOption && isSell && isPut) {
        tradeType = "SOLD_PUT";
        optionPosition += Math.abs(trade.quantity);
      } else if (isOption && isBuy && isPut) {
        tradeType = "BOUGHT_PUT";
        optionPosition = Math.max(0, optionPosition - Math.abs(trade.quantity));
        isWheelTrade = trade.proceeds < 0; // buyback
      } else if (isOption && isSell && isCall) {
        tradeType = "SOLD_CALL";
        optionPosition += Math.abs(trade.quantity);
      } else if (isOption && isBuy && isCall) {
        tradeType = "BOUGHT_CALL";
        optionPosition = Math.max(0, optionPosition - Math.abs(trade.quantity));
        isWheelTrade = trade.proceeds < 0; // buyback
      } else if (isStock && isBuy && (assignedOptionInfo = findAssignedOption(trade, "PUT"))) {
        tradeType = "ASSIGNED";
        sharePosition += Math.abs(trade.quantity);
        // Assignment closes the put position
        optionPosition = Math.max(0, optionPosition - Math.abs(trade.quantity) / 100);
        isWheelTrade = false; // Stock trades don't contribute to premium
      } else if (isStock && isBuy) {
        tradeType = "BOUGHT_SHARES";
        sharePosition += Math.abs(trade.quantity);
        isWheelTrade = false; // Stock trades don't contribute to premium
      } else if (isStock && isSell && (assignedOptionInfo = findAssignedOption(trade, "CALL"))) {
        tradeType = "CALLED_AWAY";
        sharePosition -= Math.abs(trade.quantity);
        // Called away closes the call position
        optionPosition = Math.max(0, optionPosition - Math.abs(trade.quantity) / 100);
        isWheelTrade = false; // Stock trades don't contribute to premium
      } else if (isStock && isSell) {
        tradeType = "SOLD_SHARES";
        sharePosition -= Math.abs(trade.quantity);
        isWheelTrade = false; // Stock trades don't contribute to premium
      }

      // Handle option expiration or assignment close
      if (isOption && trade.proceeds === 0 && isBuy) {
        // Check if this is an assignment close (the option was assigned, not expired)
        const expiryStr = trade.expiry?.toISOString().split("T")[0];
        const optionKey = expiryStr && trade.strike ? `${expiryStr}:${trade.strike}` : null;
        const isAssignmentClose = optionKey && (
          (isPut && assignedPuts.has(optionKey)) ||
          (isCall && assignedCalls.has(optionKey))
        );

        if (isAssignmentClose) {
          // Keep the BOUGHT_PUT/BOUGHT_CALL type so this trade is included in
          // cycleTradeIndices for matchTradesForCycle to properly pair open/close
          // and detect assignment. Since proceeds=0, premium≈0 so cycleRealizedPnL
          // is unaffected.
        } else {
          tradeType = "EXPIRED";
        }
      }

      const newTotalPosition = sharePosition + optionPosition * 100;
      const dateStr = trade.tradeDate.toISOString().split("T")[0];

      // Cycle starts: position went from 0 to non-zero
      if (prevTotalPosition === 0 && newTotalPosition !== 0) {
        cycleNumber++;
        let entryType: WheelCycle["entryType"];
        let entryDescription: string;

        if (tradeType === "SOLD_PUT") {
          entryType = "sold_put";
          entryDescription = `Sold PUT $${trade.strike}`;
        } else if (tradeType === "SOLD_CALL") {
          entryType = "sold_call";
          entryDescription = `Sold CALL $${trade.strike}`;
        } else if (tradeType === "ASSIGNED") {
          entryType = "assigned";
          const price = trade.strike || Math.abs(trade.proceeds / trade.quantity);
          entryDescription = `Assigned ${Math.abs(trade.quantity)} @ $${price.toFixed(2)}`;
        } else if (tradeType === "BOUGHT_SHARES") {
          entryType = "bought_shares";
          const price = Math.abs(trade.proceeds / trade.quantity);
          entryDescription = `Bought ${Math.abs(trade.quantity)} @ $${price.toFixed(2)}`;
        } else {
          entryType = "sold_put";
          entryDescription = "Unknown entry";
        }

        // Reset P&L and trade tracking for new cycle
        cycleRealizedPnL = 0;
        cycleCapitalDeployed = 0;
        cyclePremiumReceived = 0;
        cycleTradeIndices = [];

        // Calculate initial capital deployed
        if ((tradeType === "SOLD_PUT" || tradeType === "SOLD_CALL") && trade.strike) {
          // Option sold: capital at risk is strike * 100 - premium received
          const premium = trade.proceeds + trade.commission;
          cycleCapitalDeployed = trade.strike * Math.abs(trade.quantity) * (trade.multiplier || 100) - premium;
          cyclePremiumReceived = premium;
          cycleRealizedPnL = premium; // Premium received is realized
        } else if (tradeType === "ASSIGNED" || tradeType === "BOUGHT_SHARES") {
          // Stock purchase: capital is cost of shares
          cycleCapitalDeployed = Math.abs(trade.proceeds);
        }

        currentCycle = {
          cycleNumber,
          startDate: dateStr,
          endDate: null,
          status: "in_progress",
          totalPremium: 0,
          shareQuantity: 0,
          entryStrike: trade.strike || Math.abs(trade.proceeds / Math.abs(trade.quantity)),
          exitPrice: null,
          roc: 0,
          annualizedRoc: 0,
          durationDays: 0,
          trades: [],
          entryType,
          entryDescription,
          exitType: "in_progress",
          exitDescription: null,
          realizedPnL: 0,
          unrealizedPnL: null,
          capitalDeployed: 0,
          pnlPercent: null,
        };

        runningCostBasis = trade.strike || Math.abs(trade.proceeds / Math.abs(trade.quantity));
      }

      // Add trade to current cycle
      if (tradeType && currentCycle) {
        cycleTradeIndices.push(tradeIdx);
        const premium = trade.proceeds + trade.commission;

        // Update running cost basis
        if (tradeType === "ASSIGNED" && trade.strike) {
          runningCostBasis = trade.strike;
        } else if (tradeType === "BOUGHT_SHARES") {
          runningCostBasis = Math.abs(trade.proceeds / trade.quantity);
        }
        if (isWheelTrade && isOption) {
          const shareEquiv = currentCycle.shareQuantity || 100;
          runningCostBasis -= premium / shareEquiv;
        }

        // Track realized P&L based on trade type (skip cycle-starting trades already handled)
        if (prevTotalPosition !== 0 || tradeType !== "SOLD_PUT") {
          switch (tradeType) {
            case "SOLD_PUT":
            case "SOLD_CALL":
              // Premium received is realized P&L
              cycleRealizedPnL += premium;
              cyclePremiumReceived += premium;
              break;
            case "BOUGHT_PUT":
            case "BOUGHT_CALL":
              // Buyback cost reduces realized P&L
              cycleRealizedPnL += premium; // premium is negative for buybacks
              break;
            case "EXPIRED":
              // No additional P&L - premium already counted when sold
              break;
            case "CALLED_AWAY":
              // Add (exit price - entry strike) x shares
              if (currentCycle.entryStrike > 0) {
                const exitPrice = trade.proceeds / Math.abs(trade.quantity);
                const stockPnL = (exitPrice - currentCycle.entryStrike) * Math.abs(trade.quantity);
                cycleRealizedPnL += stockPnL;
              }
              break;
            case "SOLD_SHARES":
              // Add (sell price - cost basis) x shares
              if (runningCostBasis > 0) {
                const sellPrice = trade.proceeds / Math.abs(trade.quantity);
                const stockPnL = (sellPrice - runningCostBasis) * Math.abs(trade.quantity);
                cycleRealizedPnL += stockPnL;
              }
              break;
            case "ASSIGNED":
            case "BOUGHT_SHARES":
              // No realized P&L - just acquiring shares
              // Update capital deployed to reflect actual stock cost
              cycleCapitalDeployed = Math.abs(trade.proceeds) - cyclePremiumReceived;
              break;
          }
        }

        // For ASSIGNED/CALLED_AWAY trades, use strike/expiry from the matching option
        const tradeStrike = assignedOptionInfo?.strike ?? trade.strike;
        const tradeExpiry = assignedOptionInfo?.expiry ?? trade.expiry?.toISOString().split("T")[0] ?? null;

        const wheelTrade: WheelTrade = {
          id: trade.id,
          tradeDate: dateStr,
          type: tradeType,
          strike: tradeStrike,
          expiry: tradeExpiry,
          quantity: Math.abs(trade.quantity),
          premium,
          commission: trade.commission,
          isWheelTrade,
          runningCostBasis: Math.max(0, runningCostBasis),
        };

        (currentCycle.trades as any[]).push(wheelTrade);
        currentCycle.shareQuantity = sharePosition;

        if (isWheelTrade) {
          currentCycle.totalPremium += premium;
        }
      }

      // Cycle ends: position went from non-zero to 0
      if (prevTotalPosition !== 0 && newTotalPosition === 0 && currentCycle) {
        currentCycle.endDate = dateStr;

        if (tradeType === "CALLED_AWAY") {
          currentCycle.status = "called_away";
          currentCycle.exitType = "called_away";
          const exitPrice = trade.proceeds / Math.abs(trade.quantity);
          currentCycle.exitPrice = exitPrice;
          currentCycle.exitDescription = `Called away @ $${exitPrice.toFixed(2)}`;
        } else if (tradeType === "SOLD_SHARES") {
          currentCycle.status = "sold_shares";
          currentCycle.exitType = "sold_shares";
          const exitPrice = trade.proceeds / Math.abs(trade.quantity);
          currentCycle.exitPrice = exitPrice;
          currentCycle.exitDescription = `Sold @ $${exitPrice.toFixed(2)}`;
        } else if (tradeType === "EXPIRED" || (isOption && trade.proceeds === 0)) {
          currentCycle.status = "expired_worthless";
          currentCycle.exitType = isPut ? "put_expired" : "cc_expired";
          currentCycle.exitDescription = isPut ? "PUT expired worthless" : "CC expired worthless";
        } else if (tradeType === "BOUGHT_PUT" || tradeType === "BOUGHT_CALL") {
          // Closed option position (buyback to close)
          currentCycle.status = "closed";
          currentCycle.exitType = isPut ? "put_closed" : "cc_closed";
          currentCycle.exitDescription = isPut ? "PUT bought back" : "CC bought back";
        }

        // Calculate metrics
        const startMs = new Date(currentCycle.startDate).getTime();
        const endMs = new Date(currentCycle.endDate).getTime();
        currentCycle.durationDays = Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24));

        const capitalAtRisk = currentCycle.entryStrike * 100;
        const totalProfit = currentCycle.totalPremium +
          (currentCycle.exitPrice ? (currentCycle.exitPrice - currentCycle.entryStrike) * (currentCycle.shareQuantity || 100) : 0);

        currentCycle.roc = capitalAtRisk > 0 ? (totalProfit / capitalAtRisk) * 100 : 0;
        currentCycle.annualizedRoc = currentCycle.durationDays > 0
          ? currentCycle.roc * (365 / currentCycle.durationDays)
          : 0;

        // Set final P&L values for completed cycle
        currentCycle.realizedPnL = cycleRealizedPnL;
        currentCycle.unrealizedPnL = null; // Completed cycles have no unrealized P&L
        currentCycle.capitalDeployed = cycleCapitalDeployed > 0 ? cycleCapitalDeployed : capitalAtRisk;
        currentCycle.pnlPercent = currentCycle.capitalDeployed > 0
          ? (cycleRealizedPnL / currentCycle.capitalDeployed) * 100
          : null;

        // Only count completed cycles that had option trades
        const optionTradeTypes = ["SOLD_PUT", "BOUGHT_PUT", "SOLD_CALL", "BOUGHT_CALL", "EXPIRED"];
        const hasOptionTrades = (currentCycle.trades as any[]).some((t) => optionTradeTypes.includes(t.type));
        if (hasOptionTrades) {
          // Convert raw trades to matched trades using tracked indices (not date range)
          const rawTrades = cycleTradeIndices.map(i => filteredTrades[i]);
          currentCycle.trades = this.matchTradesForCycle(rawTrades, symbol) as any;
          cycles.push(currentCycle);
        }
        currentCycle = null;
        cycleTradeIndices = [];
        runningCostBasis = 0;
        cycleRealizedPnL = 0;
        cycleCapitalDeployed = 0;
        cyclePremiumReceived = 0;
      }
    }

    // Add in-progress cycle
    if (currentCycle) {
      const startMs = new Date(currentCycle.startDate).getTime();
      currentCycle.durationDays = Math.ceil((Date.now() - startMs) / (1000 * 60 * 60 * 24));

      currentCycle.capitalDeployed = cycleCapitalDeployed > 0
        ? cycleCapitalDeployed
        : currentCycle.entryStrike * 100;

      // Calculate unrealized P&L for in-progress cycles using live prices
      let unrealizedPnL = 0;
      let openOptionPremium = 0; // Premium already counted in realized that should move to unrealized

      if (cachedData) {
        // For held shares: (currentPrice - adjustedCostBasis) x shareQuantity
        if (sharePosition > 0 && runningCostBasis > 0) {
          const currentPrice = cachedData.marketPrices.get(symbol);
          if (currentPrice != null) {
            unrealizedPnL += (currentPrice - runningCostBasis) * sharePosition;
          }
        }

        // For open options: use IBKR's pre-calculated unrealizedPnl
        // IBKR's unrealizedPnl = costBasis - marketValue (premium received - cost to close)
        // Since we already counted premium in cycleRealizedPnL, we need to move it to unrealized
        if (optionPosition > 0 && cachedData.positions) {
          for (const pos of cachedData.positions) {
            if (pos.contract.secType === "OPT" &&
                pos.contract.symbol === symbol &&
                pos.pos < 0 && // short position
                pos.unrealizedPnl != null) {
              unrealizedPnL += pos.unrealizedPnl;
              // Track the premium for this open position (avgCost is per contract)
              openOptionPremium += pos.avgCost * Math.abs(pos.pos);
            }
          }
        }
      }

      // Adjust realized P&L: move open option premium from realized to unrealized
      // This avoids double-counting since IBKR's unrealizedPnl already includes the premium
      currentCycle.realizedPnL = cycleRealizedPnL - openOptionPremium;
      currentCycle.unrealizedPnL = unrealizedPnL;

      // Calculate percentage using total P&L (realized + unrealized)
      const totalPnL = currentCycle.realizedPnL + unrealizedPnL;
      currentCycle.pnlPercent = currentCycle.capitalDeployed > 0
        ? (totalPnL / currentCycle.capitalDeployed) * 100
        : null;

      // Convert raw trades to matched trades using tracked indices (not date range)
      const rawTrades = cycleTradeIndices.map(i => filteredTrades[i]);
      currentCycle.trades = this.matchTradesForCycle(rawTrades, symbol) as any;
      cycles.push(currentCycle);
    }

    return cycles;
  },

  /**
   * Get ticker suggestions based on option selling activity
   * @param cachedPositions - Pre-fetched positions to avoid redundant API calls
   */
  async getSuggestions(cachedPositions?: CachedIBKRData["positions"]): Promise<WheelSuggestion[]> {
    // Get already tracked + dismissed symbols in parallel
    const [tracked, dismissed] = await Promise.all([
      prisma.wheelTracker.findMany({ select: { symbol: true } }),
      prisma.wheelSuggestionDismissal.findMany({ select: { symbol: true } }),
    ]);
    const trackedSymbols = new Set(tracked.map((t) => t.symbol));
    const dismissedSymbols = new Set(dismissed.map((d) => d.symbol));
    const excludedSymbols = Array.from(new Set([...trackedSymbols, ...dismissedSymbols]));

    // Check IBKR positions to identify which symbols have active positions
    const activePositionSymbols = new Set<string>();
    const positions = cachedPositions ?? (ibkrService.isConnected() ? await ibkrService.getPositions().catch(() => []) : []);
    for (const pos of positions) {
      if (pos.pos !== 0) {
        const symbol = pos.contract.symbol;
        if (symbol) {
          activePositionSymbols.add(symbol);
        }
      }
    }

    const baseWhere = {
      secType: "OPT",
      buySell: "SELL",
      underlying: {
        not: null,
        ...(excludedSymbols.length > 0 ? { notIn: excludedSymbols } : {}),
      },
    };

    // Aggregate via DB: totals and first/last dates
    const [byUnderlying, byUnderlyingRight] = await Promise.all([
      prisma.importedTrade.groupBy({
        by: ["underlying"],
        where: baseWhere,
        _sum: { proceeds: true },
        _min: { tradeDate: true },
        _max: { tradeDate: true },
      }),
      prisma.importedTrade.groupBy({
        by: ["underlying", "right"],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

    const countsBySymbol = new Map<string, { putCount: number; callCount: number }>();
    for (const row of byUnderlyingRight) {
      const symbol = row.underlying;
      if (!symbol || !row.right) continue;
      if (!countsBySymbol.has(symbol)) {
        countsBySymbol.set(symbol, { putCount: 0, callCount: 0 });
      }
      const counts = countsBySymbol.get(symbol)!;
      if (row.right === "P") counts.putCount += row._count._all;
      if (row.right === "C") counts.callCount += row._count._all;
    }

    const suggestions: WheelSuggestion[] = [];
    for (const row of byUnderlying) {
      const symbol = row.underlying;
      if (!symbol) continue;
      const counts = countsBySymbol.get(symbol) ?? { putCount: 0, callCount: 0 };
      const firstTradeDate = row._min.tradeDate?.toISOString().split("T")[0] ?? "";
      const lastTradeDate = row._max.tradeDate?.toISOString().split("T")[0] ?? "";
      suggestions.push({
        symbol,
        putCount: counts.putCount,
        callCount: counts.callCount,
        totalPremium: row._sum.proceeds ?? 0,
        lastTradeDate,
        firstTradeDate,
        hasActivePosition: activePositionSymbols.has(symbol),
      });
    }

    // Sort: Active positions first, then by lastTradeDate descending
    return suggestions.sort((a, b) => {
      if (a.hasActivePosition && !b.hasActivePosition) return -1;
      if (!a.hasActivePosition && b.hasActivePosition) return 1;
      return b.lastTradeDate.localeCompare(a.lastTradeDate);
    });
  },

  /**
   * Calculate aggregate metrics across all tracked tickers
   * @param summaries - Pre-computed summaries to avoid redundant fetching
   */
  getAggregateMetricsFromSummaries(summaries: WheelTickerSummary[]): WheelAggregateMetrics {
    let capitalDeployed = 0;
    let totalPremiums = 0;
    let completedCycles = 0;
    let activeWheels = 0;
    let totalRealizedPnL = 0;
    let totalUnrealizedPnL = 0;

    for (const summary of summaries) {
      totalPremiums += summary.totalPremiums;
      completedCycles += summary.completedCycles;
      totalRealizedPnL += summary.realizedPnL;
      totalUnrealizedPnL += summary.unrealizedPnL;

      if (summary.currentPhase !== "idle") {
        activeWheels++;

        // Calculate capital deployed
        if (summary.currentPhase === "csp_open" && summary.currentPosition?.strike) {
          capitalDeployed += summary.currentPosition.strike * 100 * summary.currentPosition.quantity;
        } else if (summary.currentPhase === "holding_shares" || summary.currentPhase === "cc_open") {
          capitalDeployed += summary.adjustedCostBasis * (summary.currentPosition?.quantity || 0);
        }
      }
    }

    // Calculate annualized yield (simplified - uses current deployed capital)
    const premiumYieldAnnualized = capitalDeployed > 0
      ? (totalPremiums / capitalDeployed) * 100
      : 0;

    // TODO: Implement proper buy-and-hold comparison
    const vsBuyAndHold = 0;

    const totalPnL = totalRealizedPnL + totalUnrealizedPnL;
    const totalPnLPercent = capitalDeployed > 0
      ? (totalPnL / capitalDeployed) * 100
      : null;

    return {
      capitalDeployed,
      totalPremiums,
      premiumYieldAnnualized,
      vsBuyAndHold,
      trackedCount: summaries.length,
      activeWheels,
      completedCycles,
      totalRealizedPnL,
      totalUnrealizedPnL,
      totalPnL,
      totalPnLPercent,
    };
  },

  /**
   * Calculate aggregate metrics across all tracked tickers
   * @deprecated Use getAggregateMetricsFromSummaries with pre-fetched summaries for better performance
   */
  async getAggregateMetrics(): Promise<WheelAggregateMetrics> {
    const summaries = await this.getTrackedTickers();
    return this.getAggregateMetricsFromSummaries(summaries);
  },

  /**
   * Add a ticker to tracking
   */
  async addTracker(symbol: string, startDate?: string): Promise<WheelTracker> {
    const tracker = await prisma.wheelTracker.create({
      data: {
        symbol: symbol.toUpperCase(),
        startDate: startDate ? new Date(startDate) : null,
      },
    });

    return {
      id: tracker.id,
      symbol: tracker.symbol,
      startDate: tracker.startDate?.toISOString().split("T")[0] ?? null,
      createdAt: tracker.createdAt.toISOString(),
    };
  },

  /**
   * Remove a ticker from tracking
   */
  async removeTracker(symbol: string): Promise<void> {
    await prisma.wheelTracker.delete({
      where: { symbol: symbol.toUpperCase() },
    });
  },

  /**
   * Dismiss a suggestion
   */
  async dismissSuggestion(symbol: string): Promise<void> {
    await prisma.wheelSuggestionDismissal.create({
      data: { symbol: symbol.toUpperCase() },
    });
  },

  /**
   * Undismiss a suggestion
   */
  async undismissSuggestion(symbol: string): Promise<void> {
    await prisma.wheelSuggestionDismissal.delete({
      where: { symbol: symbol.toUpperCase() },
    });
  },
};
