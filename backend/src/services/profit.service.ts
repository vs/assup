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
  StockTradeGroup,
  StockTradeDetail,
  CashTransaction,
  CurrentOptionPosition,
} from "@assup/shared";

/**
 * Check if an expiry date has passed (is before today, not including today).
 * Options expiring today are still trading and shouldn't be marked as expired
 * until the next business day when settlement occurs.
 */
function hasExpiryPassed(expiryDate: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  return expiry < today;
}

class ProfitService {
  /**
   * Get list of years that have profit data
   */
  async getAvailableYears(): Promise<number[]> {
    // Get min/max dates from trades
    const tradeStats = await prisma.importedTrade.aggregate({
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    });

    // Get min/max dates from cash transactions
    const cashStats = await prisma.cashTransaction.aggregate({
      _min: { transactionDate: true },
      _max: { transactionDate: true },
    });

    // Find overall min/max
    const dates = [
      tradeStats._min.tradeDate,
      tradeStats._max.tradeDate,
      cashStats._min.transactionDate,
      cashStats._max.transactionDate,
    ].filter((d): d is Date => d !== null);

    if (dates.length === 0) {
      // No data - return current year
      return [new Date().getFullYear()];
    }

    const minYear = Math.min(...dates.map((d) => d.getFullYear()));
    const maxYear = Math.max(...dates.map((d) => d.getFullYear()));

    // Generate array of years from min to max
    const years: number[] = [];
    for (let year = maxYear; year >= minYear; year--) {
      years.push(year);
    }

    return years;
  }

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

    // Find closing trades and expired options in range
    // This identifies which contracts were realized in this period
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const closingTrades = await prisma.importedTrade.findMany({
      where: {
        secType: "OPT",
        OR: [
          // Trades with close date in range
          {
            tradeDate: { gte: start, lte: end },
            openClose: "C",
          },
          // Trades that expired in range (expiry in the past)
          {
            expiry: { gte: start, lte: end < today ? end : today },
            openClose: "O",
          },
        ],
      },
    });

    // Get unique contract keys for trades that closed in this period
    const contractKeys = new Set(
      closingTrades.map(
        (t) => `${t.underlying || t.symbol}-${t.strike}-${t.expiry?.toISOString().split("T")[0]}-${t.right}`
      )
    );

    // Fetch ALL option trades for these contracts (including opens from previous periods)
    const allOptionTrades = await prisma.importedTrade.findMany({
      where: {
        secType: "OPT",
      },
      orderBy: { tradeDate: "asc" },
    });

    // Filter to trades matching our contract keys
    const optionTrades = allOptionTrades.filter((t) => {
      const key = `${t.underlying || t.symbol}-${t.strike}-${t.expiry?.toISOString().split("T")[0]}-${t.right}`;
      return contractKeys.has(key);
    });

    // Get all stock trades in range
    const stockTrades = await prisma.importedTrade.findMany({
      where: {
        tradeDate: { gte: start, lte: end },
        secType: "STK",
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
        stocksProfit: 0,
        dividends: 0,
        interest: 0,
        withholdingTax: 0,
        fees: 0,
        total: 0,
        tradeCount: 0,
        stockTradeCount: 0,
        assignedCount: 0,
      });
      current.setMonth(current.getMonth() + 1);
    }

    // Calculate options profit by grouping trades
    const optionGroups = this.groupOptionTrades(optionTrades);
    for (const group of optionGroups) {
      // Determine which month this trade belongs to (close date or expiry for worthless/assigned)
      let tradeDate: Date | null = null;
      if (group.closeTrade) {
        // Trade was closed - use close date
        tradeDate = new Date(group.closeTrade.tradeDate);
      } else if (group.expiry) {
        // No close trade - only count if expiry has passed (actually expired/assigned)
        // Options expiring today are still open until settlement (next business day)
        const expiryDate = new Date(group.expiry);
        if (hasExpiryPassed(expiryDate)) {
          tradeDate = expiryDate;
        }
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

    // Calculate stocks profit by grouping trades
    const stockGroups = this.groupStockTrades(stockTrades);
    for (const group of stockGroups) {
      // Stock trades are realized when sold - use sell date
      if (group.sellTrade) {
        const sellDate = new Date(group.sellTrade.tradeDate);
        const key = `${sellDate.getFullYear()}-${sellDate.getMonth() + 1}`;
        const summary = monthMap.get(key);
        if (summary) {
          summary.stocksProfit += group.profit;
          summary.stockTradeCount++;
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
        m.stocksProfit +
        m.dividends +
        m.interest +
        m.withholdingTax +
        m.fees,
    }));

    const totals = months.reduce(
      (acc, m) => ({
        optionsProfit: acc.optionsProfit + m.optionsProfit,
        stocksProfit: acc.stocksProfit + m.stocksProfit,
        dividends: acc.dividends + m.dividends,
        interest: acc.interest + m.interest,
        withholdingTax: acc.withholdingTax + m.withholdingTax,
        fees: acc.fees + m.fees,
        total: acc.total + m.total,
      }),
      {
        optionsProfit: 0,
        stocksProfit: 0,
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

    // Get unique contract keys for trades that may have closed this month
    // Include ALL today's executions (both BUY and SELL) since either could be a close:
    // - BUY closes a short position (sell-to-open earlier)
    // - SELL closes a long position (buy-to-open earlier)
    //
    // We use two key types:
    // 1. Exact keys (with strike) for normal matching
    // 2. Relaxed keys (without strike) to handle strike adjustments from corporate actions
    //    (e.g., special dividends can adjust a $55 strike to $54.70)
    const exactContractKeys = new Set(
      [...closingTrades, ...todayExecutions].map(
        (t) => `${t.underlying || t.symbol}-${t.strike}-${t.expiry?.toISOString().split("T")[0]}-${t.right}`
      )
    );
    const relaxedContractKeys = new Set(
      [...closingTrades, ...todayExecutions].map(
        (t) => `${t.underlying || t.symbol}-${t.expiry?.toISOString().split("T")[0]}-${t.right}`
      )
    );

    // Fetch ALL trades for these contracts (including opens from previous months)
    const trades = await prisma.importedTrade.findMany({
      where: {
        secType: "OPT",
      },
      orderBy: { tradeDate: "asc" },
    });

    // Filter to trades matching our contract keys
    // First try exact match, then fall back to relaxed match (for strike-adjusted contracts)
    let relevantTrades = trades.filter((t) => {
      const exactKey = `${t.underlying || t.symbol}-${t.strike}-${t.expiry?.toISOString().split("T")[0]}-${t.right}`;
      const relaxedKey = `${t.underlying || t.symbol}-${t.expiry?.toISOString().split("T")[0]}-${t.right}`;
      return exactContractKeys.has(exactKey) || relaxedContractKeys.has(relaxedKey);
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

    // Fetch asset class assignments for underlying symbols
    const underlyingSymbols = new Set<string>();
    for (const trade of relevantTrades) {
      const underlying = trade.underlying || trade.symbol.split(" ")[0];
      underlyingSymbols.add(underlying);
    }

    const assignments = await prisma.securityAssignment.findMany({
      where: {
        symbol: { in: Array.from(underlyingSymbols) },
        secType: "STK",
      },
      include: { assetClass: true },
    });

    const assignmentMap = new Map(
      assignments.map((a) => [
        a.symbol,
        {
          assetClassId: a.assetClassId,
          assetClassName: a.assetClass.name,
          assetClassColor: a.assetClass.color,
        },
      ])
    );

    // Get cash transactions
    const cashTransactions = await prisma.cashTransaction.findMany({
      where: {
        transactionDate: { gte: startDate, lte: endDate },
      },
      orderBy: { transactionDate: "asc" },
    });

    // Get all stock trades (we need full history to pair buys with sells)
    let allStockTrades = await prisma.importedTrade.findMany({
      where: {
        secType: "STK",
      },
      orderBy: { tradeDate: "asc" },
    });

    // Merge today's stock executions from TWS (for current month only)
    if (isCurrentMonth) {
      const todayStockExecutions = await this.getTodayStockExecutions();
      if (todayStockExecutions.length > 0) {
        const existingTradeIds = new Set(allStockTrades.map((t) => t.tradeId).filter(Boolean));
        const newTrades = todayStockExecutions.filter(
          (t) => !t.tradeId || !existingTradeIds.has(t.tradeId)
        );
        allStockTrades = [...allStockTrades, ...newTrades].sort(
          (a, b) => a.tradeDate.getTime() - b.tradeDate.getTime()
        );
      }
    }

    // Get stock symbols for asset class lookup
    const stockSymbols = new Set(allStockTrades.map((t) => t.symbol));
    for (const sym of stockSymbols) {
      underlyingSymbols.add(sym);
    }

    // Fetch additional asset class assignments for stock symbols not already fetched
    const additionalAssignments = await prisma.securityAssignment.findMany({
      where: {
        symbol: { in: Array.from(stockSymbols) },
        secType: "STK",
      },
      include: { assetClass: true },
    });

    for (const a of additionalAssignments) {
      if (!assignmentMap.has(a.symbol)) {
        assignmentMap.set(a.symbol, {
          assetClassId: a.assetClassId,
          assetClassName: a.assetClass.name,
          assetClassColor: a.assetClass.color,
        });
      }
    }

    // Group stock trades and filter to those sold in this month
    const allStockGroups = this.groupStockTrades(allStockTrades, assignmentMap);
    const monthStockGroups = allStockGroups.filter((g) => {
      if (g.sellTrade) {
        const sellDate = new Date(g.sellTrade.tradeDate);
        return (
          sellDate.getFullYear() === year &&
          sellDate.getMonth() + 1 === month
        );
      }
      return false;
    });

    // Group option trades (using relevant trades which include opens from previous months)
    const optionGroups = this.groupOptionTrades(relevantTrades, assignmentMap);

    // Filter to trades that closed or expired in this month
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
      // Options expiring today are still open until settlement (next business day)
      if (g.expiry) {
        const expiryDate = new Date(g.expiry);
        const expiryInThisMonth =
          expiryDate.getFullYear() === year &&
          expiryDate.getMonth() + 1 === month;
        return expiryInThisMonth && hasExpiryPassed(expiryDate);
      }
      return false;
    });

    // Add assignment premium to stock trades (ONLY for real-time trades from TWS API)
    // When a PUT is assigned, we receive shares at the strike price, but we also keep the premium
    // The stock trade's cost basis from IBKR only reflects the strike price, not the premium
    // So we need to add the PUT premium to the stock profit
    //
    // IMPORTANT: This adjustment is ONLY needed for real-time trades (ID starts with "tws-")
    // that don't have IBKR's authoritative realizedPnl. FLEX-imported trades already have
    // accurate realizedPnl from IBKR and should NOT be modified.
    //
    // We look at raw imported trades to find assignments:
    // 1. Find stock BUY trades (from assignment)
    // 2. Find PUT SELL trades (open) that match: same underlying, strike = stock price, expiry = stock buy date
    // 3. The PUT premium received is added to the stock profit
    for (const stockGroup of monthStockGroups) {
      // Skip FLEX-imported trades - they already have accurate realizedPnl from IBKR
      // Only apply assignment premium adjustment to real-time trades (synthetic IDs)
      const sellTradeId = stockGroup.sellTrade?.id || "";
      if (!sellTradeId.startsWith("tws-")) {
        continue;
      }
      // Find stock BUYs for this symbol that came from assignments
      const stockBuys = allStockTrades.filter(
        (t) => t.symbol === stockGroup.symbol && t.buySell === "BUY"
      );

      if (stockBuys.length === 0) continue;

      // For each stock BUY, find matching PUT SELL trades
      let totalAssignmentPremium = 0;
      let sharesAccountedFor = 0;
      const targetShares = stockGroup.quantity;

      // Fetch PUT trades that were assigned (marked in database)
      const assignedPutTrades = await prisma.importedTrade.findMany({
        where: {
          underlying: stockGroup.symbol,
          secType: "OPT",
          right: "P",
          buySell: "SELL",
          wasAssigned: true,
        },
        orderBy: { tradeDate: "desc" },
      });

      for (const stockBuy of stockBuys) {
        if (sharesAccountedFor >= targetShares) break;

        const buyDate = stockBuy.tradeDate.toISOString().split("T")[0];
        const buyPrice = stockBuy.tradePrice;
        const buyShares = Math.abs(stockBuy.quantity);

        // Find PUT SELL trades that match this assignment
        // Match criteria: strike = buy price, expiry = buy date
        const matchingPuts = assignedPutTrades.filter((put) => {
          const putExpiry = put.expiry?.toISOString().split("T")[0];
          const putStrike = put.strike || 0;
          return putExpiry === buyDate && Math.abs(putStrike - buyPrice) < 0.01;
        });

        for (const put of matchingPuts) {
          if (sharesAccountedFor >= targetShares) break;

          const putContracts = Math.abs(put.quantity);
          const putShares = putContracts * 100;
          const putPremium = put.proceeds; // Premium received (positive for SELL)

          // Calculate how many shares from this PUT apply
          const applicableShares = Math.min(
            putShares,
            targetShares - sharesAccountedFor,
            buyShares
          );
          const applicableContracts = applicableShares / 100;

          // Prorate the premium based on contracts used
          const premiumPerContract = putContracts > 0 ? putPremium / putContracts : 0;
          totalAssignmentPremium += premiumPerContract * applicableContracts;
          sharesAccountedFor += applicableShares;
        }
      }

      if (totalAssignmentPremium > 0) {
        // Adjust the stock profit to include the PUT premium
        stockGroup.profit += totalAssignmentPremium;
        // Also adjust cost basis (reduce it by premium received)
        stockGroup.costBasis -= totalAssignmentPremium;
      }
    }

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
    const stocksProfit = monthStockGroups.reduce((sum, g) => sum + g.profit, 0);
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
        stockTrades: monthStockGroups,
        dividends,
        interest,
        withholdingTax,
        fees,
      },
      summary: {
        year,
        month,
        optionsProfit,
        stocksProfit,
        dividends: dividendsTotal,
        interest: interestTotal,
        withholdingTax: withholdingTaxTotal,
        fees: feesTotal,
        total:
          optionsProfit +
          stocksProfit +
          dividendsTotal +
          interestTotal +
          withholdingTaxTotal +
          feesTotal,
        tradeCount: monthGroups.filter((g) => !g.wasAssigned).length,
        stockTradeCount: monthStockGroups.length,
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
        stocksProfit: detail.summary.stocksProfit,
        dividends: detail.summary.dividends,
        interest: detail.summary.interest,
        total:
          detail.summary.optionsProfit +
          detail.summary.stocksProfit +
          detail.summary.dividends +
          detail.summary.interest,
        closedTrades: detail.realized.optionTrades,
        stockTrades: detail.realized.stockTrades,
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
      conId: number | null;
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
    }>,
    assignmentMap?: Map<string, { assetClassId: string; assetClassName: string; assetClassColor: string }>
  ): OptionTradeGroup[] {
    // First, group by conId if available (most reliable - survives strike adjustments)
    // Fall back to exact key (underlying-strike-expiry-right) when conId not available
    const exactGroups = new Map<string, typeof trades>();

    for (const trade of trades) {
      // Prefer conId for grouping (unique contract identifier, never changes)
      // Fall back to composite key when conId not available
      const key = trade.conId
        ? `conId:${trade.conId}`
        : `${trade.underlying || trade.symbol}-${trade.strike}-${
            trade.expiry?.toISOString().split("T")[0]
          }-${trade.right}`;

      if (!exactGroups.has(key)) {
        exactGroups.set(key, []);
      }
      exactGroups.get(key)!.push(trade);
    }

    // Identify groups that might need strike adjustment matching:
    // - Groups with only opens (no closes) might have closes with adjusted strike
    // - Groups with only closes (no opens) might have opens with original strike
    const openOnlyGroups: Array<{ key: string; trades: typeof trades }> = [];
    const closeOnlyGroups: Array<{ key: string; trades: typeof trades }> = [];
    const completeGroups: Array<{ key: string; trades: typeof trades }> = [];

    for (const [key, groupTrades] of exactGroups) {
      const hasOpen = groupTrades.some(t => t.openClose === "O" ||
        (t.openClose === null && groupTrades.indexOf(t) === 0));
      const hasClose = groupTrades.some(t => t.openClose === "C" ||
        (t.openClose === null && groupTrades.some(other =>
          other !== t && (other.openClose === "O" || groupTrades.indexOf(other) < groupTrades.indexOf(t))
        )));

      // Check if group has both opens and closes by looking at trade directions
      const sorted = [...groupTrades].sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime());
      const hasSells = sorted.some(t => t.buySell === "SELL");
      const hasBuys = sorted.some(t => t.buySell === "BUY");
      const hasBothDirections = hasSells && hasBuys;

      if (hasBothDirections) {
        // Has both opens and closes - complete group, process normally
        completeGroups.push({ key, trades: groupTrades });
      } else if (hasSells) {
        // Only sells - likely opens without closes (may need strike adjustment matching)
        openOnlyGroups.push({ key, trades: groupTrades });
      } else {
        // Only buys - likely closes without opens (may need strike adjustment matching)
        closeOnlyGroups.push({ key, trades: groupTrades });
      }
    }

    // Try to match open-only groups with close-only groups
    // Use conId if both have it, otherwise use relaxed matching with strike tolerance
    const STRIKE_TOLERANCE_PERCENT = 0.02; // 2% tolerance for strike adjustment
    const STRIKE_TOLERANCE_ABS = 1.0; // Max $1 absolute difference

    const matchedCloseGroups = new Set<string>();

    for (const openGroup of openOnlyGroups) {
      // Get trade details from first trade in group
      const openTrade = openGroup.trades[0];
      const openUnderlying = openTrade.underlying || openTrade.symbol.split(" ")[0];
      const openExpiry = openTrade.expiry?.toISOString().split("T")[0];
      const openRight = openTrade.right;
      const openStrike = openTrade.strike || 0;
      const openConId = openTrade.conId;

      // Look for matching close-only group
      for (const closeGroup of closeOnlyGroups) {
        if (matchedCloseGroups.has(closeGroup.key)) continue;

        const closeTrade = closeGroup.trades[0];
        const closeUnderlying = closeTrade.underlying || closeTrade.symbol.split(" ")[0];
        const closeExpiry = closeTrade.expiry?.toISOString().split("T")[0];
        const closeRight = closeTrade.right;
        const closeStrike = closeTrade.strike || 0;
        const closeConId = closeTrade.conId;

        // If both have conId, use that for matching (most reliable)
        if (openConId && closeConId) {
          if (openConId === closeConId) {
            openGroup.trades.push(...closeGroup.trades);
            matchedCloseGroups.add(closeGroup.key);
            break;
          }
          continue; // Different conIds, definitely not the same contract
        }

        // Fall back to relaxed matching: same underlying/expiry/right with strike tolerance
        if (openUnderlying === closeUnderlying && openExpiry === closeExpiry && openRight === closeRight) {
          const strikeDiff = Math.abs(openStrike - closeStrike);
          const percentDiff = openStrike > 0 ? strikeDiff / openStrike : 0;

          if (strikeDiff <= STRIKE_TOLERANCE_ABS || percentDiff <= STRIKE_TOLERANCE_PERCENT) {
            // Merge the groups
            openGroup.trades.push(...closeGroup.trades);
            matchedCloseGroups.add(closeGroup.key);
            break;
          }
        }
      }

      completeGroups.push(openGroup);
    }

    // Add remaining unmatched close-only groups
    for (const closeGroup of closeOnlyGroups) {
      if (!matchedCloseGroups.has(closeGroup.key)) {
        completeGroups.push(closeGroup);
      }
    }

    // Now use the merged groups for processing
    const groups = new Map<string, typeof trades>();
    for (const group of completeGroups) {
      groups.set(group.key, group.trades);
    }

    // Create trade groups
    const result: OptionTradeGroup[] = [];

    for (const [, groupTrades] of groups) {
      // Sort by date
      const sorted = groupTrades.sort(
        (a, b) => a.tradeDate.getTime() - b.tradeDate.getTime()
      );

      // Collect ALL open and close trades (there may be multiple partial fills)
      const openTrades: (typeof trades)[0][] = [];
      const closeTrades: (typeof trades)[0][] = [];
      let wasAssigned = false;

      for (const trade of sorted) {
        if (trade.wasAssigned) wasAssigned = true;

        if (trade.openClose === "O") {
          // Explicitly marked as open
          openTrades.push(trade);
        } else if (trade.openClose === "C") {
          // Explicitly marked as close
          closeTrades.push(trade);
        } else {
          // openClose not specified - use heuristics
          if (openTrades.length === 0 && closeTrades.length === 0) {
            // First trade in the group is the opening trade
            openTrades.push(trade);
          } else if (openTrades.length > 0 && openTrades[0].buySell === trade.buySell) {
            // Same direction as original open = adding to position
            openTrades.push(trade);
          } else {
            // Opposite direction = closing position
            closeTrades.push(trade);
          }
        }
      }

      // Use first trades for display purposes
      const openTrade = openTrades[0];
      const closeTrade = closeTrades[0];

      // Calculate cost basis and sell price for clearer profit display
      // For short options (selling to open):
      //   - costBasis = premium received (positive proceeds from open) - SUM of all open trades
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

      // Sum proceeds from ALL open trades
      if (openTrades.length > 0) {
        // For SELL to open (short): proceeds is positive (premium received)
        // For BUY to open (long): proceeds is negative (premium paid)
        costBasis = openTrades.reduce((sum, t) => sum + Math.abs(t.proceeds), 0);
      }

      // Sum proceeds from ALL close trades
      if (closeTrades.length > 0) {
        // For BUY to close (closing short): proceeds is negative (cost to close)
        // For SELL to close (closing long): proceeds is positive (received)
        sellPrice = closeTrades.reduce((sum, t) => sum + Math.abs(t.proceeds), 0);

        // If any close trade has 0 proceeds, it was likely an assignment/exercise
        if (closeTrades.some(t => t.proceeds === 0)) {
          wasAssigned = true;
        }
      } else {
        // No close trade - check if option has expired
        // Options expiring today are still open until settlement (next business day)
        const first = sorted[0];
        const expiryDate = first.expiry;
        const hasExpired = expiryDate && hasExpiryPassed(expiryDate);

        if (hasExpired) {
          // Option expired worthless (or was assigned)
          expiredWorthless = !wasAssigned;
        }
        // If not expired, this is an open position - no realized P&L yet
        sellPrice = 0;
      }

      // Calculate profit using FIFO matching for partial closes
      // This matches close trades against open trades in chronological order
      const openQuantity = openTrades.reduce((sum, t) => sum + Math.abs(t.quantity), 0);
      const closeQuantity = closeTrades.reduce((sum, t) => sum + Math.abs(t.quantity), 0);

      // Prepare open trades with per-contract values for FIFO matching
      const openTradesForFifo = openTrades.map(t => ({
        remainingQty: Math.abs(t.quantity),
        pricePerContract: Math.abs(t.proceeds) / Math.abs(t.quantity),
        commissionPerContract: t.commission / Math.abs(t.quantity)
      }));

      // FIFO matching: match close trades against open trades in order
      let fifoCostBasis = 0;
      let fifoOpenCommission = 0;

      for (const closeTrade of closeTrades) {
        let closeQtyRemaining = Math.abs(closeTrade.quantity);

        for (const openTradeInfo of openTradesForFifo) {
          if (closeQtyRemaining <= 0) break;
          if (openTradeInfo.remainingQty <= 0) continue;

          const matchedQty = Math.min(closeQtyRemaining, openTradeInfo.remainingQty);

          fifoCostBasis += openTradeInfo.pricePerContract * matchedQty;
          fifoOpenCommission += openTradeInfo.commissionPerContract * matchedQty;

          openTradeInfo.remainingQty -= matchedQty;
          closeQtyRemaining -= matchedQty;
        }
      }

      // If no closes yet, use full cost basis (for unrealized/projected calculations)
      const effectiveCostBasis = closeQuantity > 0 ? fifoCostBasis : costBasis;

      // Commission: FIFO-matched portion of open commissions + all close commissions
      const openCommission = openTrades.reduce((sum, t) => sum + t.commission, 0);
      const closeCommission = closeTrades.reduce((sum, t) => sum + t.commission, 0);
      const effectiveCommission = closeQuantity > 0
        ? fifoOpenCommission + closeCommission
        : openCommission;

      let profit: number;
      if (openTrade?.buySell === "SELL") {
        // Short position: profit = premium received - cost to close - commissions
        profit = effectiveCostBasis - sellPrice - effectiveCommission;
      } else {
        // Long position: profit = sell price - cost basis - commissions
        profit = sellPrice - effectiveCostBasis - effectiveCommission;
      }

      // For assigned options, set profit to 0 (P&L is realized in stock position)
      if (wasAssigned) {
        profit = 0;
      }

      // For open positions (not closed, not expired), no realized P&L yet
      const isOpenPosition = closeQuantity === 0 && !expiredWorthless && !wasAssigned;
      if (isOpenPosition) {
        profit = 0;
      }

      const first = sorted[0];
      const underlying = first.underlying || first.symbol.split(" ")[0];
      const assetClass = assignmentMap?.get(underlying);

      // Aggregate open trades for display (sum quantity and proceeds, average price)
      const openProceeds = openTrades.reduce((sum, t) => sum + t.proceeds, 0);
      const openAvgPrice = openQuantity !== 0 ? Math.abs(openProceeds / openQuantity / 100) : 0;

      // Aggregate close trades for display
      const closeProceeds = closeTrades.reduce((sum, t) => sum + t.proceeds, 0);
      const closeAvgPrice = closeQuantity !== 0 ? Math.abs(closeProceeds / closeQuantity / 100) : 0;

      // Use close trade's strike if available (it has the adjusted value after corporate actions)
      // Otherwise fall back to open trade's strike
      const displayStrike = closeTrade?.strike || openTrade?.strike || first.strike || 0;

      result.push({
        underlying,
        strike: displayStrike,
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
              quantity: openQuantity,
              tradePrice: openAvgPrice,
              proceeds: openProceeds,
              commission: openCommission,
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
              quantity: closeQuantity,
              tradePrice: closeAvgPrice,
              proceeds: closeProceeds,
              commission: closeCommission,
              buySell: closeTrade.buySell,
              wasAssigned: closeTrade.wasAssigned,
            }
          : undefined,
        costBasis: effectiveCostBasis,
        sellPrice,
        profit,
        wasAssigned,
        expiredWorthless,
        assetClassId: assetClass?.assetClassId,
        assetClassName: assetClass?.assetClassName,
        assetClassColor: assetClass?.assetClassColor,
      });
    }

    return result;
  }

  /**
   * Group stock trades for display - uses IBKR's realizedPnl directly instead of FIFO matching
   * Returns only sell trades (realized P&L)
   */
  private groupStockTrades(
    trades: Array<{
      id: string;
      tradeId: string;
      symbol: string;
      tradeDate: Date;
      quantity: number;
      tradePrice: number;
      proceeds: number;
      commission: number;
      buySell: string;
      openClose: string | null;
      costBasis: number | null;
      realizedPnl: number | null;
    }>,
    assignmentMap?: Map<string, { assetClassId: string; assetClassName: string; assetClassColor: string }>
  ): StockTradeGroup[] {
    const result: StockTradeGroup[] = [];

    // Only process sell trades - they have the realized P&L from IBKR
    const sells = trades.filter((t) => t.buySell === "SELL");

    for (const sell of sells) {
      // Skip sells without realized P&L data
      if (sell.realizedPnl === null) continue;

      const assetClass = assignmentMap?.get(sell.symbol);
      const quantity = Math.abs(sell.quantity);
      const sellProceeds = quantity * sell.tradePrice - sell.commission;

      // Use IBKR's cost basis if available, otherwise derive from proceeds and P&L
      const costBasis = sell.costBasis !== null
        ? sell.costBasis
        : sellProceeds - sell.realizedPnl;

      const sellDetail: StockTradeDetail = {
        id: sell.id,
        symbol: sell.symbol,
        tradeDate: sell.tradeDate.toISOString().split("T")[0],
        quantity,
        tradePrice: sell.tradePrice,
        proceeds: quantity * sell.tradePrice,
        commission: sell.commission,
        buySell: sell.buySell,
      };

      result.push({
        symbol: sell.symbol,
        buyTrade: undefined, // Not tracking individual buys
        sellTrade: sellDetail,
        costBasis,
        sellProceeds,
        profit: sell.realizedPnl,
        quantity,
        assetClassId: assetClass?.assetClassId,
        assetClassName: assetClass?.assetClassName,
        assetClassColor: assetClass?.assetClassColor,
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
      return this.convertExecutionsToTrades(executions, commissions, "OPT");
    } catch (err) {
      console.error("Failed to fetch today's executions:", err);
      return [];
    }
  }

  /**
   * Fetch today's stock executions from TWS and calculate realizedPnl from cost basis
   */
  async getTodayStockExecutions(): Promise<ImportedTrade[]> {
    if (!ibkrService.isConnected()) {
      return [];
    }

    try {
      const { executions, commissions } = await ibkrService.getExecutions();
      const stockTrades = this.convertExecutionsToTrades(executions, commissions, "STK");

      // For SELL trades, we need to calculate realizedPnl from cost basis
      // Look up cost basis from existing BUY trades in the database
      const sellTrades = stockTrades.filter((t) => t.buySell === "SELL");
      if (sellTrades.length === 0) {
        return stockTrades;
      }

      const symbols = [...new Set(sellTrades.map((t) => t.symbol))];
      const buyTrades = await prisma.importedTrade.findMany({
        where: {
          symbol: { in: symbols },
          secType: "STK",
          buySell: "BUY",
        },
        orderBy: { tradeDate: "asc" },
      });

      // Build cost basis per symbol using FIFO
      const costBasisMap = new Map<string, { totalQty: number; totalCost: number }>();
      for (const buy of buyTrades) {
        const existing = costBasisMap.get(buy.symbol) || { totalQty: 0, totalCost: 0 };
        existing.totalQty += Math.abs(buy.quantity);
        existing.totalCost += Math.abs(buy.quantity) * buy.tradePrice + buy.commission;
        costBasisMap.set(buy.symbol, existing);
      }

      // Calculate realizedPnl for each sell trade
      for (const sell of sellTrades) {
        const costInfo = costBasisMap.get(sell.symbol);
        if (costInfo && costInfo.totalQty > 0) {
          const avgCostPerShare = costInfo.totalCost / costInfo.totalQty;
          const sellQty = Math.abs(sell.quantity);
          const costBasis = avgCostPerShare * sellQty;
          const sellProceeds = sellQty * sell.tradePrice - sell.commission;
          sell.costBasis = costBasis;
          sell.realizedPnl = sellProceeds - costBasis;
        }
      }

      return stockTrades;
    } catch (err) {
      console.error("Failed to fetch today's stock executions:", err);
      return [];
    }
  }

  /**
   * Convert TWS ExecutionDetail objects to ImportedTrade-like objects
   * for use with the existing groupOptionTrades logic
   */
  private convertExecutionsToTrades(
    executions: ExecutionDetail[],
    commissions: Map<string, CommissionReport>,
    secTypeFilter: "OPT" | "STK" = "OPT"
  ): ImportedTrade[] {
    const trades: ImportedTrade[] = [];

    // Group executions by execId prefix (same order fills get merged)
    // execId format: "0000e0d5.67576f4f.01.01" - the last part is the fill number
    const groupedByOrder = new Map<string, ExecutionDetail[]>();

    for (const exec of executions) {
      // Filter by security type
      if (exec.contract.secType !== secTypeFilter) continue;

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
      const quantity = totalShares; // In contracts (for options) or shares (for stocks)

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

      // Parse expiry from contract (only for options)
      const expiryStr = contract.lastTradeDateOrContractMonth || "";
      const expiry = secTypeFilter === "OPT" ? this.parseContractExpiry(expiryStr) : null;

      // Calculate proceeds (positive for selling, negative for buying)
      // Options have a multiplier of 100, stocks have multiplier of 1
      const multiplier = secTypeFilter === "OPT"
        ? (contract.multiplier ? parseInt(String(contract.multiplier)) : 100)
        : 1;
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
        symbol: secTypeFilter === "OPT"
          ? (contract.localSymbol || contract.symbol || "")
          : (contract.symbol || ""),
        description: null,
        conId: contract.conId || null,
        secType: secTypeFilter,
        strike: secTypeFilter === "OPT" ? (contract.strike || null) : null,
        expiry,
        right: secTypeFilter === "OPT"
          ? ((contract.right?.charAt(0).toUpperCase() || null) as "C" | "P" | null)
          : null,
        underlying: secTypeFilter === "OPT" ? (contract.symbol || null) : null,
        multiplier: secTypeFilter === "OPT"
          ? (contract.multiplier ? parseInt(String(contract.multiplier)) : 100)
          : 1,
        tradeDate,
        quantity: isBuy ? quantity : -quantity, // Negative for sells
        tradePrice: avgPrice,
        proceeds,
        commission: totalCommission,
        buySell: isBuy ? "BUY" : "SELL",
        openClose: null, // TWS doesn't provide this directly, will infer in grouping
        costBasis: null,
        realizedPnl: null,
        wasAssigned: false,
        assignmentDate: null,
      };

      trades.push(trade);
    }

    return trades;
  }
}

export const profitService = new ProfitService();
