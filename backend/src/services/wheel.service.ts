/**
 * Wheel Strategy Service
 * Handles cycle reconstruction, metrics calculation, and ticker suggestions
 */

import { SecType } from "@stoqey/ib";
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

interface RawTrade {
  id: string;
  tradeDate: Date;
  symbol: string;
  underlying: string | null;
  secType: string;
  strike: number | null;
  expiry: Date | null;
  right: string | null;
  quantity: number;
  proceeds: number;
  commission: number;
  buySell: string;
  wasAssigned: boolean;
  multiplier: number;
}

// Cached IBKR data to avoid redundant API calls
interface CachedIBKRData {
  positions: Array<{
    account: string;
    contract: { secType?: string; symbol?: string; right?: string; strike?: number; lastTradeDateOrContractMonth?: string };
    pos: number;
    avgCost: number;
    marketPrice?: number;
    marketValue?: number;
  }>;
  todayTrades: RawTrade[];
  marketPrices: Map<string, number>;
}

export const wheelService = {
  /**
   * Fetch all IBKR data needed for wheel calculations in one batch
   */
  async fetchIBKRData(symbols: string[]): Promise<CachedIBKRData> {
    const result: CachedIBKRData = {
      positions: [],
      todayTrades: [],
      marketPrices: new Map(),
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

      // Fetch market prices for all symbols in parallel
      if (symbols.length > 0) {
        const pricePromises = symbols.map(async (symbol) => {
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
   * Get all tracked tickers with summary data
   */
  async getTrackedTickers(cachedData?: CachedIBKRData): Promise<WheelTickerSummary[]> {
    const trackers = await prisma.wheelTracker.findMany({
      orderBy: { createdAt: "desc" },
    });

    // Fetch IBKR data once if not provided
    const symbols = trackers.map(t => t.symbol);
    const ibkrData = cachedData ?? await this.fetchIBKRData(symbols);

    // Process all tickers in parallel
    const summaries = await Promise.all(
      trackers.map(tracker =>
        this.getTickerSummary(tracker.symbol, tracker.startDate, ibkrData)
      )
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
    const cycles = await this.reconstructCycles(symbol, tracker.startDate, ibkrData.todayTrades);
    const summary = await this.getTickerSummaryWithCycles(symbol, tracker.startDate, cycles, ibkrData);

    return { ...summary, cycles };
  },

  /**
   * Get ticker summary with current state and metrics
   * Uses cached IBKR data to avoid redundant API calls
   */
  async getTickerSummary(symbol: string, startDate: Date | null, cachedData?: CachedIBKRData): Promise<WheelTickerSummary> {
    const todayTrades = cachedData?.todayTrades ?? [];
    const cycles = await this.reconstructCycles(symbol, startDate, todayTrades);
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

    const optionPos = positions.find(
      (p) => p.contract.secType === "OPT" && p.contract.symbol === symbol && p.pos !== 0
    );
    const stockPos = positions.find(
      (p) => p.contract.secType === "STK" && p.contract.symbol === symbol && p.pos > 0
    );

    let currentPhase: WheelTickerSummary["currentPhase"] = "idle";
    let currentPosition: WheelTickerSummary["currentPosition"] = null;

    if (optionPos && optionPos.pos < 0) {
      // Short option position
      const isCall = optionPos.contract.right === "C";
      currentPhase = isCall ? "cc_open" : "csp_open";

      const expiry = optionPos.contract.lastTradeDateOrContractMonth;
      const expiryDate = expiry ? new Date(
        expiry.slice(0, 4) + "-" + expiry.slice(4, 6) + "-" + expiry.slice(6, 8)
      ) : null;
      const dte = expiryDate
        ? Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
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
    } else if (stockPos) {
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
    // Start with the first assignment strike, subtract all premiums
    let adjustedCostBasis = 0;

    if (currentCycle) {
      const assignmentTrade = currentCycle.trades.find((t) => t.type === "ASSIGNED");
      if (assignmentTrade && assignmentTrade.strike) {
        adjustedCostBasis = assignmentTrade.strike - (currentCycle.totalPremium / (currentCycle.shareQuantity || 100));
      } else {
        // No assignment yet, use CSP strike
        const cspTrade = currentCycle.trades.find((t) => t.type === "SOLD_PUT");
        if (cspTrade && cspTrade.strike) {
          adjustedCostBasis = cspTrade.strike - (currentCycle.totalPremium / 100);
        }
      }
    }

    // Get current price from cached market data
    const currentPrice = cachedData?.marketPrices.get(symbol) ?? null;

    const breakEven = adjustedCostBasis;
    const percentBelowMarket = currentPrice && adjustedCostBasis > 0
      ? ((currentPrice - adjustedCostBasis) / currentPrice) * 100
      : null;

    return {
      symbol,
      currentPhase,
      adjustedCostBasis,
      totalPremiums,
      currentPrice,
      breakEven,
      percentBelowMarket,
      cycleCount: cycles.length,
      completedCycles: completedCycles.length,
      currentPosition,
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
   * Reconstruct wheel cycles from trade history
   * A cycle = any period where position (shares + options) is non-zero
   * @param cachedTodayTrades - Pre-fetched today's trades to avoid redundant API calls
   */
  async reconstructCycles(symbol: string, startDate: Date | null, cachedTodayTrades?: RawTrade[]): Promise<WheelCycle[]> {
    // Get all trades for this underlying
    const whereClause: Record<string, unknown> = {
      OR: [
        { underlying: symbol },
        { symbol: symbol, secType: "STK" },
      ],
    };

    if (startDate) {
      whereClause.tradeDate = { gte: startDate };
    }

    const dbTrades = await prisma.importedTrade.findMany({
      where: whereClause,
      orderBy: { tradeDate: "asc" },
    }) as RawTrade[];

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

    // Merge and sort by date
    const trades = [...dbTrades, ...newExecutions].sort(
      (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
    );

    // Query assigned options to detect stock assignments
    // (wasAssigned is set on option trades, not stock trades)
    const assignedOptions = await prisma.importedTrade.findMany({
      where: {
        underlying: symbol,
        secType: "OPT",
        wasAssigned: true,
      },
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

    // Helper to find matching assigned option for a stock trade
    // Returns { strike, expiry } if assignment found, null otherwise
    const findAssignedOption = (trade: RawTrade, type: "PUT" | "CALL"): { strike: number; expiry: string } | null => {
      // Check the old wasAssigned field first (for backward compat with test data)
      if (trade.wasAssigned && trade.strike) {
        return { strike: trade.strike, expiry: trade.expiry?.toISOString().split("T")[0] || trade.tradeDate.toISOString().split("T")[0] };
      }

      // Check against assigned options lookup
      const tradeDate = trade.tradeDate.toISOString().split("T")[0];
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
    let sharePosition = 0;
    let optionPosition = 0; // positive = short options (sold contracts)
    let cycleNumber = 0;
    let runningCostBasis = 0;

    for (const trade of trades) {
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

      // Handle option expiration (position closed but no BUY trade - synthetic)
      if (isOption && trade.proceeds === 0 && isBuy) {
        tradeType = "EXPIRED";
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

        currentCycle = {
          cycleNumber,
          startDate: dateStr,
          endDate: null,
          status: "in_progress",
          totalPremium: 0,
          shareQuantity: 0,
          entryStrike: trade.strike || 0,
          exitPrice: null,
          roc: 0,
          annualizedRoc: 0,
          durationDays: 0,
          trades: [],
          entryType,
          entryDescription,
          exitType: "in_progress",
          exitDescription: null,
        };

        runningCostBasis = trade.strike || Math.abs(trade.proceeds / Math.abs(trade.quantity));
      }

      // Add trade to current cycle
      if (tradeType && currentCycle) {
        const premium = trade.proceeds - trade.commission;

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

        currentCycle.trades.push(wheelTrade);
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
          // Closed option position (buyback to close, not roll)
          currentCycle.status = "expired_worthless"; // reuse status
          currentCycle.exitType = isPut ? "put_expired" : "cc_expired";
          currentCycle.exitDescription = isPut ? "PUT closed" : "CC closed";
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

        // Only count completed cycles that had option trades
        const optionTradeTypes = ["SOLD_PUT", "BOUGHT_PUT", "SOLD_CALL", "BOUGHT_CALL", "EXPIRED"];
        const hasOptionTrades = currentCycle.trades.some((t) => optionTradeTypes.includes(t.type));
        if (hasOptionTrades) {
          cycles.push(currentCycle);
        }
        currentCycle = null;
        runningCostBasis = 0;
      }
    }

    // Add in-progress cycle
    if (currentCycle) {
      const startMs = new Date(currentCycle.startDate).getTime();
      currentCycle.durationDays = Math.ceil((Date.now() - startMs) / (1000 * 60 * 60 * 24));
      cycles.push(currentCycle);
    }

    return cycles;
  },

  /**
   * Get ticker suggestions based on option selling activity
   * @param cachedPositions - Pre-fetched positions to avoid redundant API calls
   */
  async getSuggestions(cachedPositions?: CachedIBKRData["positions"]): Promise<WheelSuggestion[]> {
    // Get already tracked symbols
    const tracked = await prisma.wheelTracker.findMany({
      select: { symbol: true },
    });
    const trackedSymbols = new Set(tracked.map((t) => t.symbol));

    // Get dismissed symbols
    const dismissed = await prisma.wheelSuggestionDismissal.findMany({
      select: { symbol: true },
    });
    const dismissedSymbols = new Set(dismissed.map((d) => d.symbol));

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

    // Find symbols with sold options
    const optionTrades = await prisma.importedTrade.findMany({
      where: {
        secType: "OPT",
        buySell: "SELL",
        underlying: { not: null },
      },
      select: {
        underlying: true,
        right: true,
        proceeds: true,
        tradeDate: true,
      },
      orderBy: { tradeDate: "desc" },
    });

    // Aggregate by underlying
    const symbolStats = new Map<string, WheelSuggestion>();

    for (const trade of optionTrades) {
      const symbol = trade.underlying!;
      if (trackedSymbols.has(symbol) || dismissedSymbols.has(symbol)) continue;

      if (!symbolStats.has(symbol)) {
        symbolStats.set(symbol, {
          symbol,
          putCount: 0,
          callCount: 0,
          totalPremium: 0,
          lastTradeDate: trade.tradeDate.toISOString().split("T")[0],
          firstTradeDate: trade.tradeDate.toISOString().split("T")[0],
          hasActivePosition: activePositionSymbols.has(symbol),
        });
      }

      const stats = symbolStats.get(symbol)!;
      if (trade.right === "P") stats.putCount++;
      if (trade.right === "C") stats.callCount++;
      stats.totalPremium += trade.proceeds;

      const dateStr = trade.tradeDate.toISOString().split("T")[0];
      if (dateStr < stats.firstTradeDate) stats.firstTradeDate = dateStr;
    }

    // Sort: Active positions first, then by lastTradeDate descending
    return Array.from(symbolStats.values()).sort((a, b) => {
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

    for (const summary of summaries) {
      totalPremiums += summary.totalPremiums;
      completedCycles += summary.completedCycles;

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

    return {
      capitalDeployed,
      totalPremiums,
      premiumYieldAnnualized,
      vsBuyAndHold,
      trackedCount: summaries.length,
      activeWheels,
      completedCycles,
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
