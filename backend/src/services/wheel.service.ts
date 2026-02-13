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

export const wheelService = {
  /**
   * Get all tracked tickers with summary data
   */
  async getTrackedTickers(): Promise<WheelTickerSummary[]> {
    const trackers = await prisma.wheelTracker.findMany({
      orderBy: { createdAt: "desc" },
    });

    const summaries: WheelTickerSummary[] = [];
    for (const tracker of trackers) {
      const summary = await this.getTickerSummary(tracker.symbol, tracker.startDate);
      summaries.push(summary);
    }

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

    const summary = await this.getTickerSummary(symbol, tracker.startDate);
    const cycles = await this.reconstructCycles(symbol, tracker.startDate);

    return { ...summary, cycles };
  },

  /**
   * Get ticker summary with current state and metrics
   */
  async getTickerSummary(symbol: string, startDate: Date | null): Promise<WheelTickerSummary> {
    const cycles = await this.reconstructCycles(symbol, startDate);
    const completedCycles = cycles.filter((c) => c.status !== "in_progress");
    const currentCycle = cycles.find((c) => c.status === "in_progress");

    // Calculate totals
    const totalPremiums = cycles.reduce((sum, c) => sum + c.totalPremium, 0);

    // Determine current phase from IBKR positions
    let positions: Array<{
      account: string;
      contract: { secType?: string; symbol?: string; right?: string; strike?: number; lastTradeDateOrContractMonth?: string };
      pos: number;
      avgCost: number;
      marketPrice?: number;
      marketValue?: number;
    }> = [];

    try {
      if (ibkrService.isConnected()) {
        positions = await ibkrService.getPositions();
      }
    } catch {
      // If positions fetch fails, continue with empty positions
    }

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

    // Get current price from market data
    let currentPrice: number | null = null;
    try {
      if (ibkrService.isConnected()) {
        const stockContract = {
          symbol,
          secType: SecType.STK,
          exchange: "SMART",
          currency: "USD",
        };
        const marketData = await ibkrService.getMarketData(stockContract);
        currentPrice = marketData?.last ?? marketData?.close ?? null;
      }
    } catch {
      // If market data fetch fails, continue with null price
    }

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
   * Reconstruct wheel cycles from trade history
   */
  async reconstructCycles(symbol: string, startDate: Date | null): Promise<WheelCycle[]> {
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

    const trades = await prisma.importedTrade.findMany({
      where: whereClause,
      orderBy: { tradeDate: "asc" },
    }) as RawTrade[];

    const cycles: WheelCycle[] = [];
    let currentCycle: WheelCycle | null = null;
    let sharePosition = 0;
    let runningCostBasis = 0;
    let cycleNumber = 0;

    for (const trade of trades) {
      const isOption = trade.secType === "OPT";
      const isStock = trade.secType === "STK";
      const isSell = trade.buySell === "SELL";
      const isBuy = trade.buySell === "BUY";
      const isPut = trade.right === "P";
      const isCall = trade.right === "C";

      let tradeType: WheelTrade["type"] | null = null;
      let isWheelTrade = true;

      if (isOption && isSell && isPut) {
        // Sold PUT - starts or continues a cycle
        tradeType = "SOLD_PUT";
        if (!currentCycle) {
          cycleNumber++;
          currentCycle = {
            cycleNumber,
            startDate: trade.tradeDate.toISOString().split("T")[0],
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
          };
        }
      } else if (isOption && isBuy && isPut) {
        // Bought PUT - buyback or protective put
        tradeType = "BOUGHT_PUT";
        isWheelTrade = trade.proceeds < 0; // buyback has negative proceeds (paying)
      } else if (isOption && isSell && isCall) {
        // Sold CALL - covered call
        tradeType = "SOLD_CALL";
      } else if (isOption && isBuy && isCall) {
        // Bought CALL - buyback
        tradeType = "BOUGHT_CALL";
        isWheelTrade = trade.proceeds < 0;
      } else if (isStock && isBuy && trade.wasAssigned) {
        // Assignment from put
        tradeType = "ASSIGNED";
        sharePosition += trade.quantity;
        if (currentCycle) {
          currentCycle.shareQuantity = sharePosition;
        }
      } else if (isStock && isSell) {
        // Sold shares - could be called away or manual sell
        tradeType = trade.wasAssigned ? "CALLED_AWAY" : "SOLD_SHARES";
        sharePosition -= Math.abs(trade.quantity);

        if (currentCycle && sharePosition <= 0) {
          // Cycle complete
          currentCycle.endDate = trade.tradeDate.toISOString().split("T")[0];
          currentCycle.status = trade.wasAssigned ? "called_away" : "sold_shares";
          currentCycle.exitPrice = trade.proceeds / Math.abs(trade.quantity);
        }
      }

      if (tradeType && currentCycle) {
        // Calculate premium (positive = received, negative = paid)
        const premium = trade.proceeds - trade.commission;

        // Update running cost basis
        if (tradeType === "ASSIGNED" && trade.strike) {
          runningCostBasis = trade.strike;
        }
        if (isWheelTrade) {
          runningCostBasis -= premium / (currentCycle.shareQuantity || 100);
        }

        const wheelTrade: WheelTrade = {
          id: trade.id,
          tradeDate: trade.tradeDate.toISOString().split("T")[0],
          type: tradeType,
          strike: trade.strike,
          expiry: trade.expiry?.toISOString().split("T")[0] ?? null,
          quantity: Math.abs(trade.quantity),
          premium,
          commission: trade.commission,
          isWheelTrade,
          runningCostBasis: Math.max(0, runningCostBasis),
        };

        currentCycle.trades.push(wheelTrade);
        if (isWheelTrade) {
          currentCycle.totalPremium += premium;
        }

        // If cycle completed, calculate metrics and push
        if (currentCycle.status !== "in_progress") {
          const startMs = new Date(currentCycle.startDate).getTime();
          const endMs = new Date(currentCycle.endDate!).getTime();
          currentCycle.durationDays = Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24));

          // ROC = total profit / capital at risk
          const capitalAtRisk = currentCycle.entryStrike * 100;
          const totalProfit = currentCycle.totalPremium +
            (currentCycle.exitPrice ? (currentCycle.exitPrice - currentCycle.entryStrike) * 100 : 0);

          currentCycle.roc = capitalAtRisk > 0 ? (totalProfit / capitalAtRisk) * 100 : 0;
          currentCycle.annualizedRoc = currentCycle.durationDays > 0
            ? currentCycle.roc * (365 / currentCycle.durationDays)
            : 0;

          cycles.push(currentCycle);
          currentCycle = null;
          runningCostBasis = 0;
        }
      }
    }

    // Add in-progress cycle if exists
    if (currentCycle) {
      const startMs = new Date(currentCycle.startDate).getTime();
      currentCycle.durationDays = Math.ceil((Date.now() - startMs) / (1000 * 60 * 60 * 24));
      cycles.push(currentCycle);
    }

    return cycles;
  },

  /**
   * Get ticker suggestions based on option selling activity
   */
  async getSuggestions(): Promise<WheelSuggestion[]> {
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
        });
      }

      const stats = symbolStats.get(symbol)!;
      if (trade.right === "P") stats.putCount++;
      if (trade.right === "C") stats.callCount++;
      stats.totalPremium += trade.proceeds;

      const dateStr = trade.tradeDate.toISOString().split("T")[0];
      if (dateStr < stats.firstTradeDate) stats.firstTradeDate = dateStr;
    }

    // Sort by last trade date (most recent first)
    return Array.from(symbolStats.values()).sort(
      (a, b) => b.lastTradeDate.localeCompare(a.lastTradeDate)
    );
  },

  /**
   * Calculate aggregate metrics across all tracked tickers
   */
  async getAggregateMetrics(): Promise<WheelAggregateMetrics> {
    const summaries = await this.getTrackedTickers();

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
