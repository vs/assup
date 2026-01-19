/**
 * Service for calculating profit from options trading, dividends, and interest
 */

import { prisma } from "../db/index.js";
import { ibkrService } from "./ibkr.js";
import { formatDisplayName } from "@assup/shared";
import type { ImportedTrade } from "@prisma/client";
import type { ExecutionDetail, CommissionReport } from "@stoqey/ib";
import type {
  MonthSummary,
  MonthDetail,
  MonthProfitView,
  MonthlyProfitResponse,
  OptionTradeGroup,
  CashTransaction,
  CurrentOptionPosition,
} from "@assup/shared";

class ProfitService {
  /**
   * Get monthly profit summaries for a date range
   */
  async getMonthlyProfits(
    startDate?: Date,
    endDate?: Date
  ): Promise<MonthlyProfitResponse> {
    // Default to last 12 months if no dates provided
    const end = endDate || new Date();
    const start =
      startDate ||
      new Date(end.getFullYear(), end.getMonth() - 11, 1);

    // Get all trades in range
    const trades = await prisma.importedTrade.findMany({
      where: {
        tradeDate: { gte: start, lte: end },
        secType: "OPT",
      },
      orderBy: { tradeDate: "asc" },
    });

    // Get all cash transactions in range
    const cashTransactions = await prisma.cashTransaction.findMany({
      where: {
        transactionDate: { gte: start, lte: end },
      },
      orderBy: { transactionDate: "asc" },
    });

    // Group by month
    const monthMap = new Map<string, MonthSummary>();

    // Initialize months
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    while (current <= end) {
      const key = `${current.getFullYear()}-${current.getMonth() + 1}`;
      monthMap.set(key, {
        year: current.getFullYear(),
        month: current.getMonth() + 1,
        optionsProfit: 0,
        dividends: 0,
        interest: 0,
        withholdingTax: 0,
        fees: 0,
        total: 0,
        tradeCount: 0,
        assignedCount: 0,
      });
      current.setMonth(current.getMonth() + 1);
    }

    // Calculate options profit by grouping trades
    const now = new Date();
    const optionGroups = this.groupOptionTrades(trades);
    for (const group of optionGroups) {
      // Determine which month this trade belongs to (close date or expiry for worthless/assigned)
      let tradeDate: Date | null = null;
      if (group.closeTrade) {
        // Trade was closed - use close date
        tradeDate = new Date(group.closeTrade.tradeDate);
      } else if (group.expiry) {
        // No close trade - only count if expiry has passed (actually expired/assigned)
        const expiryDate = new Date(group.expiry);
        if (expiryDate < now) {
          tradeDate = expiryDate;
        }
        // If expiry is in the future, don't count it yet - it's still an open position
      }

      if (tradeDate) {
        const key = `${tradeDate.getFullYear()}-${tradeDate.getMonth() + 1}`;
        const summary = monthMap.get(key);
        if (summary) {
          if (!group.wasAssigned) {
            summary.optionsProfit += group.profit;
            summary.tradeCount++;
          } else {
            summary.assignedCount++;
          }
        }
      }
    }

    // Aggregate cash transactions
    for (const tx of cashTransactions) {
      const date = new Date(tx.transactionDate);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      const summary = monthMap.get(key);
      if (summary) {
        switch (tx.type) {
          case "DIVIDEND":
            summary.dividends += tx.amount;
            break;
          case "INTEREST":
            summary.interest += tx.amount;
            break;
          case "WITHHOLDING_TAX":
            summary.withholdingTax += tx.amount;
            break;
          case "FEE":
            summary.fees += tx.amount;
            break;
        }
      }
    }

    // Calculate totals
    const months = Array.from(monthMap.values()).map((m) => ({
      ...m,
      total:
        m.optionsProfit +
        m.dividends +
        m.interest +
        m.withholdingTax +
        m.fees,
    }));

    const totals = months.reduce(
      (acc, m) => ({
        optionsProfit: acc.optionsProfit + m.optionsProfit,
        dividends: acc.dividends + m.dividends,
        interest: acc.interest + m.interest,
        withholdingTax: acc.withholdingTax + m.withholdingTax,
        fees: acc.fees + m.fees,
        total: acc.total + m.total,
      }),
      {
        optionsProfit: 0,
        dividends: 0,
        interest: 0,
        withholdingTax: 0,
        fees: 0,
        total: 0,
      }
    );

    return {
      months: months.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      }),
      totals,
    };
  }

  /**
   * Get detailed breakdown for a specific month
   */
  async getMonthDetail(year: number, month: number): Promise<MonthDetail> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // First, find option trades that closed in this month
    // Only include expired options if expiry date has passed
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    const closingTrades = await prisma.importedTrade.findMany({
      where: {
        secType: "OPT",
        OR: [
          // Trades with close date in this month
          {
            tradeDate: { gte: startDate, lte: endDate },
            openClose: "C",
          },
          // Trades that expired in this month (expiry in the past)
          {
            expiry: { gte: startDate, lte: endDate < today ? endDate : today },
            openClose: "O", // Only open trades (no close = expired/assigned)
          },
        ],
      },
    });

    // Fetch today's executions from TWS (for current month only)
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
    const todayExecutions = isCurrentMonth ? await this.getTodayExecutions() : [];

    // Add today's executions that are closing trades to the closing trades set
    const closingFromTws = todayExecutions.filter((t) => t.buySell === "BUY");

    // Get unique contract keys for these trades
    const contractKeys = new Set(
      [...closingTrades, ...closingFromTws].map(
        (t) => `${t.underlying || t.symbol}-${t.strike}-${t.expiry?.toISOString().split("T")[0]}-${t.right}`
      )
    );

    // Fetch ALL trades for these contracts (including opens from previous months)
    const trades = await prisma.importedTrade.findMany({
      where: {
        secType: "OPT",
      },
      orderBy: { tradeDate: "asc" },
    });

    // Filter to only trades matching our contract keys
    let relevantTrades = trades.filter((t) => {
      const key = `${t.underlying || t.symbol}-${t.strike}-${t.expiry?.toISOString().split("T")[0]}-${t.right}`;
      return contractKeys.has(key);
    });

    // Merge today's executions with imported trades (avoid duplicates by tradeId)
    if (todayExecutions.length > 0) {
      const existingTradeIds = new Set(relevantTrades.map((t) => t.tradeId).filter(Boolean));
      const newTrades = todayExecutions.filter(
        (t) => !t.tradeId || !existingTradeIds.has(t.tradeId)
      );
      relevantTrades = [...relevantTrades, ...newTrades].sort(
        (a, b) => a.tradeDate.getTime() - b.tradeDate.getTime()
      );
    }

    // Get cash transactions
    const cashTransactions = await prisma.cashTransaction.findMany({
      where: {
        transactionDate: { gte: startDate, lte: endDate },
      },
      orderBy: { transactionDate: "asc" },
    });

    // Group option trades (using relevant trades which include opens from previous months)
    const optionGroups = this.groupOptionTrades(relevantTrades);

    // Filter to trades that closed or expired in this month
    const now = new Date();
    const monthGroups = optionGroups.filter((g) => {
      // If there's a close trade, check if it's in this month
      if (g.closeTrade) {
        const closeDate = new Date(g.closeTrade.tradeDate);
        return (
          closeDate.getFullYear() === year &&
          closeDate.getMonth() + 1 === month
        );
      }
      // If no close trade, check if option expired in this month AND expiry has passed
      // (don't show future expirations as "expired" - those are still open positions)
      if (g.expiry) {
        const expiryDate = new Date(g.expiry);
        const expiryInThisMonth =
          expiryDate.getFullYear() === year &&
          expiryDate.getMonth() + 1 === month;
        const expiryHasPassed = expiryDate < now;
        return expiryInThisMonth && expiryHasPassed;
      }
      return false;
    });

    // Categorize cash transactions
    const dividends: CashTransaction[] = [];
    const interest: CashTransaction[] = [];
    const withholdingTax: CashTransaction[] = [];
    const fees: CashTransaction[] = [];

    for (const tx of cashTransactions) {
      const mapped: CashTransaction = {
        id: tx.id,
        transactionId: tx.transactionId,
        symbol: tx.symbol || undefined,
        description: tx.description,
        transactionDate: tx.transactionDate.toISOString().split("T")[0],
        amount: tx.amount,
        currency: tx.currency,
        type: tx.type as CashTransaction["type"],
      };

      switch (tx.type) {
        case "DIVIDEND":
          dividends.push(mapped);
          break;
        case "INTEREST":
          interest.push(mapped);
          break;
        case "WITHHOLDING_TAX":
          withholdingTax.push(mapped);
          break;
        case "FEE":
          fees.push(mapped);
          break;
      }
    }

    // Calculate summary
    const optionsProfit = monthGroups
      .filter((g) => !g.wasAssigned)
      .reduce((sum, g) => sum + g.profit, 0);
    const dividendsTotal = dividends.reduce((sum, d) => sum + d.amount, 0);
    const interestTotal = interest.reduce((sum, i) => sum + i.amount, 0);
    const withholdingTaxTotal = withholdingTax.reduce(
      (sum, w) => sum + w.amount,
      0
    );
    const feesTotal = fees.reduce((sum, f) => sum + f.amount, 0);

    return {
      year,
      month,
      realized: {
        optionTrades: monthGroups,
        dividends,
        interest,
        withholdingTax,
        fees,
      },
      summary: {
        year,
        month,
        optionsProfit,
        dividends: dividendsTotal,
        interest: interestTotal,
        withholdingTax: withholdingTaxTotal,
        fees: feesTotal,
        total:
          optionsProfit +
          dividendsTotal +
          interestTotal +
          withholdingTaxTotal +
          feesTotal,
        tradeCount: monthGroups.filter((g) => !g.wasAssigned).length,
        assignedCount: monthGroups.filter((g) => g.wasAssigned).length,
      },
    };
  }

  /**
   * Get current month profit view with unrealized and projected
   */
  async getCurrentMonthProfit(): Promise<MonthProfitView> {
    const now = new Date();
    return this.getMonthProfitView(now.getFullYear(), now.getMonth() + 1);
  }

  /**
   * Get next month profit view with unrealized and projected
   */
  async getNextMonthProfit(): Promise<MonthProfitView> {
    const now = new Date();
    const nextMonth = now.getMonth() + 2;
    const year = nextMonth > 12 ? now.getFullYear() + 1 : now.getFullYear();
    const month = nextMonth > 12 ? 1 : nextMonth;
    return this.getMonthProfitView(year, month);
  }

  /**
   * Get profit view for a specific month including unrealized/projected from current positions
   */
  private async getMonthProfitView(
    year: number,
    month: number
  ): Promise<MonthProfitView> {
    // Get realized data
    const detail = await this.getMonthDetail(year, month);

    // Get current positions from IBKR for unrealized/projected
    const unrealizedPositions: CurrentOptionPosition[] = [];
    const projectedPositions: CurrentOptionPosition[] = [];

    if (ibkrService.isConnected()) {
      try {
        const positions = await ibkrService.getPositions();

        // Collect underlying symbols to fetch asset classes
        const underlyingSymbols = new Set<string>();
        for (const pos of positions) {
          if (pos.contract.secType === "OPT" && pos.pos !== 0) {
            const symbol = pos.contract.symbol || "";
            underlyingSymbols.add(symbol.split(" ")[0] || symbol);
          }
        }

        // Fetch asset class assignments for underlying symbols
        const assignments = await prisma.securityAssignment.findMany({
          where: {
            symbol: { in: Array.from(underlyingSymbols) },
            secType: "STK",
          },
          include: { assetClass: true },
        });
        const assignmentMap = new Map(
          assignments.map((a) => [a.symbol, a])
        );

        for (const pos of positions) {
          if (pos.contract.secType !== "OPT") continue;

          // Skip positions with zero quantity
          if (pos.pos === 0) continue;

          // Parse expiry date from contract
          const expiryStr = pos.contract.lastTradeDateOrContractMonth;
          if (!expiryStr) continue;

          const expiry = this.parseContractExpiry(expiryStr);
          if (!expiry) continue;

          // Check if expiry is in target month
          if (
            expiry.getFullYear() !== year ||
            expiry.getMonth() + 1 !== month
          ) {
            continue;
          }

          const strike = pos.contract.strike || 0;
          const right = (pos.contract.right || "C") as "C" | "P";

          // avgCost from IBKR already includes the multiplier (it's per contract, not per share)
          // Cost basis = avgCost * number of contracts
          const costBasis = pos.avgCost * Math.abs(pos.pos);
          const marketValue = pos.marketValue || 0;

          // Unrealized P&L calculation
          // For short positions: profit = premium received - current cost to close
          // marketValue for short is negative (liability), costBasis is positive (premium received)
          const unrealizedPnl = pos.pos < 0
            ? costBasis + marketValue  // Short: premium - abs(marketValue)
            : marketValue - costBasis; // Long: marketValue - costBasis

          // Projected profit if option expires worthless
          // For short positions: we keep the premium (cost basis)
          // For long positions: we lose the premium (negative)
          let projectedProfit = 0;
          if (pos.pos < 0) {
            // Short position - premium received is cost basis
            projectedProfit = costBasis;
          }

          const symbol = pos.contract.symbol || "";
          const underlying = symbol.split(" ")[0] || symbol;
          const assignment = assignmentMap.get(underlying);

          const optionPos: CurrentOptionPosition = {
            symbol,
            displayName: formatDisplayName({
              symbol: underlying,
              secType: "OPT",
              strike,
              right,
              lastTradeDateOrContractMonth: pos.contract.lastTradeDateOrContractMonth,
            }),
            underlying,
            strike,
            expiry: expiry.toISOString().split("T")[0],
            right,
            quantity: pos.pos,
            avgCost: pos.avgCost,
            marketPrice: pos.marketPrice || 0,
            marketValue,
            unrealizedPnl,
            projectedProfit,
            assetClassId: assignment?.assetClassId,
            assetClassName: assignment?.assetClass.name,
            assetClassColor: assignment?.assetClass.color,
          };

          unrealizedPositions.push(optionPos);
          if (projectedProfit > 0) {
            projectedPositions.push(optionPos);
          }
        }
      } catch {
        // IBKR not connected, skip unrealized/projected
      }
    }

    const unrealizedValue = unrealizedPositions.reduce(
      (sum, p) => sum + p.unrealizedPnl,
      0
    );
    const projectedValue = projectedPositions.reduce(
      (sum, p) => sum + p.projectedProfit,
      0
    );

    return {
      year,
      month,
      realized: {
        optionsProfit: detail.summary.optionsProfit,
        dividends: detail.summary.dividends,
        interest: detail.summary.interest,
        total:
          detail.summary.optionsProfit +
          detail.summary.dividends +
          detail.summary.interest,
        closedTrades: detail.realized.optionTrades,
        cashTransactions: [
          ...detail.realized.dividends,
          ...detail.realized.interest,
        ],
      },
      unrealized: {
        value: unrealizedValue,
        positions: unrealizedPositions,
      },
      projected: {
        value: projectedValue,
        positions: projectedPositions,
      },
    };
  }

  /**
   * Group option trades by contract (symbol + strike + expiry + right)
   * and pair open/close trades
   */
  private groupOptionTrades(
    trades: Array<{
      id: string;
      tradeId: string;
      symbol: string;
      description: string | null;
      strike: number | null;
      expiry: Date | null;
      right: string | null;
      underlying: string | null;
      tradeDate: Date;
      quantity: number;
      tradePrice: number;
      proceeds: number;
      commission: number;
      buySell: string;
      openClose: string | null;
      wasAssigned: boolean;
    }>
  ): OptionTradeGroup[] {
    // Group by contract key
    const groups = new Map<string, typeof trades>();

    for (const trade of trades) {
      const key = `${trade.underlying || trade.symbol}-${trade.strike}-${
        trade.expiry?.toISOString().split("T")[0]
      }-${trade.right}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(trade);
    }

    // Create trade groups
    const result: OptionTradeGroup[] = [];

    for (const [, groupTrades] of groups) {
      // Sort by date
      const sorted = groupTrades.sort(
        (a, b) => a.tradeDate.getTime() - b.tradeDate.getTime()
      );

      // Find open and close trades
      let openTrade: (typeof trades)[0] | undefined;
      let closeTrade: (typeof trades)[0] | undefined;
      let wasAssigned = false;

      for (const trade of sorted) {
        if (trade.wasAssigned) wasAssigned = true;

        if (trade.openClose === "O" || (!openTrade && trade.buySell === "SELL")) {
          openTrade = trade;
        } else if (trade.openClose === "C" || trade.buySell === "BUY") {
          closeTrade = trade;
        }
      }

      // Calculate cost basis and sell price for clearer profit display
      // For short options (selling to open):
      //   - costBasis = premium received (positive proceeds from open)
      //   - sellPrice = cost to close (absolute value of close proceeds, or 0 if expired worthless)
      //   - profit = costBasis - sellPrice - commissions
      // For long options (buying to open):
      //   - costBasis = premium paid (absolute value of negative proceeds from open)
      //   - sellPrice = proceeds from selling (positive proceeds from close)
      //   - profit = sellPrice - costBasis - commissions

      const totalCommission = sorted.reduce((sum, t) => sum + t.commission, 0);

      let costBasis = 0;
      let sellPrice = 0;
      let expiredWorthless = false;

      if (openTrade) {
        // For SELL to open (short): proceeds is positive (premium received)
        // For BUY to open (long): proceeds is negative (premium paid)
        if (openTrade.buySell === "SELL") {
          // Short position - we received premium
          costBasis = Math.abs(openTrade.proceeds);
        } else {
          // Long position - we paid premium
          costBasis = Math.abs(openTrade.proceeds);
        }
      }

      if (closeTrade) {
        // For BUY to close (closing short): proceeds is negative (cost to close)
        // For SELL to close (closing long): proceeds is positive (received)
        sellPrice = Math.abs(closeTrade.proceeds);

        // If close trade has 0 proceeds, it was likely an assignment/exercise
        if (closeTrade.proceeds === 0) {
          wasAssigned = true;
        }
      } else {
        // No close trade - option expired worthless or was assigned
        expiredWorthless = !wasAssigned;
        sellPrice = 0;
      }

      // Calculate profit based on position type
      let profit: number;
      if (openTrade?.buySell === "SELL") {
        // Short position: profit = premium received - cost to close - commissions
        profit = costBasis - sellPrice - totalCommission;
      } else {
        // Long position: profit = sell price - cost basis - commissions
        profit = sellPrice - costBasis - totalCommission;
      }

      // For assigned options, set profit to 0 (P&L is realized in stock position)
      if (wasAssigned) {
        profit = 0;
      }

      const first = sorted[0];
      result.push({
        underlying: first.underlying || first.symbol.split(" ")[0],
        strike: first.strike || 0,
        expiry: first.expiry?.toISOString().split("T")[0] || "",
        right: (first.right || "C") as "C" | "P",
        openTrade: openTrade
          ? {
              id: openTrade.id,
              symbol: openTrade.symbol,
              underlying: openTrade.underlying || openTrade.symbol.split(" ")[0],
              strike: openTrade.strike || 0,
              expiry: openTrade.expiry?.toISOString().split("T")[0] || "",
              right: (openTrade.right || "C") as "C" | "P",
              tradeDate: openTrade.tradeDate.toISOString().split("T")[0],
              quantity: openTrade.quantity,
              tradePrice: openTrade.tradePrice,
              proceeds: openTrade.proceeds,
              commission: openTrade.commission,
              buySell: openTrade.buySell,
              wasAssigned: openTrade.wasAssigned,
            }
          : undefined,
        closeTrade: closeTrade
          ? {
              id: closeTrade.id,
              symbol: closeTrade.symbol,
              underlying: closeTrade.underlying || closeTrade.symbol.split(" ")[0],
              strike: closeTrade.strike || 0,
              expiry: closeTrade.expiry?.toISOString().split("T")[0] || "",
              right: (closeTrade.right || "C") as "C" | "P",
              tradeDate: closeTrade.tradeDate.toISOString().split("T")[0],
              quantity: closeTrade.quantity,
              tradePrice: closeTrade.tradePrice,
              proceeds: closeTrade.proceeds,
              commission: closeTrade.commission,
              buySell: closeTrade.buySell,
              wasAssigned: closeTrade.wasAssigned,
            }
          : undefined,
        costBasis,
        sellPrice,
        profit,
        wasAssigned,
        expiredWorthless,
      });
    }

    return result;
  }

  /**
   * Parse IBKR contract expiry format (YYYYMMDD)
   */
  private parseContractExpiry(expiryStr: string): Date | null {
    if (!expiryStr) return null;

    // YYYYMMDD format
    if (/^\d{8}$/.test(expiryStr)) {
      const year = parseInt(expiryStr.slice(0, 4));
      const month = parseInt(expiryStr.slice(4, 6)) - 1;
      const day = parseInt(expiryStr.slice(6, 8));
      return new Date(year, month, day);
    }

    // Try ISO format
    const date = new Date(expiryStr);
    return isNaN(date.getTime()) ? null : date;
  }

  /**
   * Fetch today's option executions from TWS and convert to ImportedTrade-like objects
   */
  async getTodayExecutions(): Promise<ImportedTrade[]> {
    if (!ibkrService.isConnected()) {
      return [];
    }

    try {
      const { executions, commissions } = await ibkrService.getExecutions();
      return this.convertExecutionsToTrades(executions, commissions);
    } catch (err) {
      console.error("Failed to fetch today's executions:", err);
      return [];
    }
  }

  /**
   * Convert TWS ExecutionDetail objects to ImportedTrade-like objects
   * for use with the existing groupOptionTrades logic
   */
  private convertExecutionsToTrades(
    executions: ExecutionDetail[],
    commissions: Map<string, CommissionReport>
  ): ImportedTrade[] {
    const trades: ImportedTrade[] = [];

    // Group executions by execId prefix (same order fills get merged)
    // execId format: "0000e0d5.67576f4f.01.01" - the last part is the fill number
    const groupedByOrder = new Map<string, ExecutionDetail[]>();

    for (const exec of executions) {
      // Only process options
      if (exec.contract.secType !== "OPT") continue;

      // Group by order (everything except last part of execId)
      const execId = exec.execution.execId || "";
      const orderKey = execId.split(".").slice(0, -1).join(".") || execId;

      if (!groupedByOrder.has(orderKey)) {
        groupedByOrder.set(orderKey, []);
      }
      groupedByOrder.get(orderKey)!.push(exec);
    }

    // Convert grouped executions to trades
    for (const [, orderExecs] of groupedByOrder) {
      if (orderExecs.length === 0) continue;

      const first = orderExecs[0];
      const contract = first.contract;
      const exec = first.execution;

      // Aggregate quantity and calculate average price for partial fills
      let totalShares = 0;
      let totalValue = 0;
      let totalCommission = 0;

      for (const e of orderExecs) {
        const shares = e.execution.shares || 0;
        const price = e.execution.price || 0;
        totalShares += shares;
        totalValue += shares * price;
        // Get commission from commissions map
        const execId = e.execution.execId || "";
        const commissionReport = commissions.get(execId);
        totalCommission += commissionReport?.commission || 0;
      }

      const avgPrice = totalShares > 0 ? totalValue / totalShares : 0;
      const quantity = totalShares; // In contracts (not shares)

      // Determine buy/sell and open/close
      const side = exec.side || ""; // "BOT" or "SLD"
      const isBuy = side === "BOT";

      // Parse execution time (format: "YYYYMMDD HH:MM:SS timezone")
      const execTime = exec.time || "";
      let tradeDate = new Date();
      if (execTime) {
        const match = execTime.match(/^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (match) {
          tradeDate = new Date(
            parseInt(match[1]),
            parseInt(match[2]) - 1,
            parseInt(match[3]),
            parseInt(match[4]),
            parseInt(match[5]),
            parseInt(match[6])
          );
        }
      }

      // Parse expiry from contract
      const expiryStr = contract.lastTradeDateOrContractMonth || "";
      const expiry = this.parseContractExpiry(expiryStr);

      // Calculate proceeds (positive for selling, negative for buying)
      // Options have a multiplier of 100
      const multiplier = contract.multiplier ? parseInt(String(contract.multiplier)) : 100;
      const proceeds = isBuy
        ? -(quantity * avgPrice * multiplier)
        : (quantity * avgPrice * multiplier);

      // Create a synthetic ImportedTrade
      // Use negative IDs to distinguish from database records
      const syntheticId = `tws-${exec.execId || Date.now()}`;

      const trade: ImportedTrade = {
        id: syntheticId,
        importBatchId: "tws-live",
        tradeId: exec.execId || syntheticId,
        symbol: contract.localSymbol || contract.symbol || "",
        description: null,
        conId: contract.conId || null,
        secType: "OPT",
        strike: contract.strike || null,
        expiry,
        right: (contract.right?.charAt(0).toUpperCase() || null) as "C" | "P" | null,
        underlying: contract.symbol || null,
        multiplier: contract.multiplier ? parseInt(String(contract.multiplier)) : 100,
        tradeDate,
        quantity: isBuy ? quantity : -quantity, // Negative for sells
        tradePrice: avgPrice,
        proceeds,
        commission: totalCommission,
        buySell: isBuy ? "BUY" : "SELL",
        openClose: null, // TWS doesn't provide this directly, will infer in grouping
        wasAssigned: false,
        assignmentDate: null,
      };

      trades.push(trade);
    }

    return trades;
  }
}

export const profitService = new ProfitService();
