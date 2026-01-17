/**
 * Service for calculating profit from options trading, dividends, and interest
 */

import { prisma } from "../db/index.js";
import { ibkrService } from "./ibkr.js";
import { formatDisplayName } from "@assup/shared";
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
    const optionGroups = this.groupOptionTrades(trades);
    for (const group of optionGroups) {
      if (group.closeTrade) {
        const closeDate = new Date(group.closeTrade.tradeDate);
        const key = `${closeDate.getFullYear()}-${closeDate.getMonth() + 1}`;
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

    // Get all option trades that closed in this month
    const trades = await prisma.importedTrade.findMany({
      where: {
        tradeDate: { gte: startDate, lte: endDate },
        secType: "OPT",
      },
      orderBy: { tradeDate: "asc" },
    });

    // Get cash transactions
    const cashTransactions = await prisma.cashTransaction.findMany({
      where: {
        transactionDate: { gte: startDate, lte: endDate },
      },
      orderBy: { transactionDate: "asc" },
    });

    // Group option trades
    const optionGroups = this.groupOptionTrades(trades);

    // Filter to only trades with closing trades in this month
    const monthGroups = optionGroups.filter((g) => {
      if (!g.closeTrade) return false;
      const closeDate = new Date(g.closeTrade.tradeDate);
      return (
        closeDate.getFullYear() === year &&
        closeDate.getMonth() + 1 === month
      );
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

      // Calculate profit: proceeds from sell - proceeds from buy (proceeds already signed)
      const totalProceeds = sorted.reduce((sum, t) => sum + t.proceeds, 0);
      const totalCommission = sorted.reduce((sum, t) => sum + t.commission, 0);
      const profit = totalProceeds - totalCommission;

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
        profit,
        wasAssigned,
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
}

export const profitService = new ProfitService();
