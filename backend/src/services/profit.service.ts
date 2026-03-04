/**
 * Service for calculating profit from options trading, dividends, and interest
 */

import { SecType } from "@stoqey/ib";
import { prisma } from "../db/index.js";
import { ibkrService } from "./ibkr.js";
import { cnbExchangeRateService } from "./cnbExchangeRate.service.js";
import { formatDisplayName } from "@assup/shared";
import { groupOptionTrades, groupStockTrades, hasExpiryPassed, type OptionTradeInput, type StockTradeInput, type AssetClassMap } from "./tradeMatching.js";
import type { ImportedTrade } from "@prisma/client";
import type {
  MonthSummary,
  MonthDetail,
  MonthProfitView,
  MonthlyProfitResponse,
  OptionTradeGroup,
  StockTradeGroup,
  CashTransaction,
  CurrentOptionPosition,
  AllPositionsView,
} from "@assup/shared";

/**
 * Convert an amount from a foreign currency to USD using CNB rates.
 * CNB rates are expressed as CZK per 1 unit of foreign currency.
 * To convert currency X to USD: (amount in X) * (CZK per X) / (CZK per USD)
 */
async function convertToUsd(
  amount: number,
  currency: string,
  date: Date
): Promise<number> {
  // USD amounts don't need conversion
  if (currency === "USD") {
    return amount;
  }

  // Get USD rate (CZK per 1 USD)
  const usdRate = await cnbExchangeRateService.getRate(date, "USD");
  if (!usdRate) {
    // If no USD rate available, return original amount (will be treated as USD)
    console.warn(`No USD exchange rate found for ${date.toISOString().split("T")[0]}`);
    return amount;
  }

  // CZK amounts: divide by USD rate to get USD
  if (currency === "CZK") {
    return amount / usdRate;
  }

  // Other currencies: get the currency's rate and convert via CZK
  const currencyRate = await cnbExchangeRateService.getRate(date, currency);
  if (!currencyRate) {
    // If no rate available, return original amount (will be treated as USD)
    console.warn(`No ${currency} exchange rate found for ${date.toISOString().split("T")[0]}`);
    return amount;
  }

  // Convert: amount * (CZK per currency) / (CZK per USD) = amount in USD
  return (amount * currencyRate) / usdRate;
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

    // Aggregate cash transactions (convert non-USD to USD)
    for (const tx of cashTransactions) {
      const date = new Date(tx.transactionDate);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      const summary = monthMap.get(key);
      if (summary) {
        // Convert amount to USD if in different currency
        const amountUsd = await convertToUsd(tx.amount, tx.currency, date);
        switch (tx.type) {
          case "DIVIDEND":
            summary.dividends += amountUsd;
            break;
          case "INTEREST":
            summary.interest += amountUsd;
            break;
          case "WITHHOLDING_TAX":
            summary.withholdingTax += amountUsd;
            break;
          case "FEE":
            summary.fees += amountUsd;
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

    // Categorize cash transactions (convert non-USD to USD)
    const dividends: CashTransaction[] = [];
    const interest: CashTransaction[] = [];
    const withholdingTax: CashTransaction[] = [];
    const fees: CashTransaction[] = [];

    for (const tx of cashTransactions) {
      // Convert amount to USD if in different currency
      const amountUsd = await convertToUsd(tx.amount, tx.currency, tx.transactionDate);
      const mapped: CashTransaction = {
        id: tx.id,
        transactionId: tx.transactionId,
        symbol: tx.symbol || undefined,
        description: tx.description,
        transactionDate: tx.transactionDate.toISOString().split("T")[0],
        amount: amountUsd,
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
   * Get all open option positions regardless of expiry month
   */
  async getAllPositions(): Promise<AllPositionsView> {
    const positions: CurrentOptionPosition[] = [];

    if (ibkrService.isConnected()) {
      try {
        const ibkrPositions = await ibkrService.getPositions();

        // Collect underlying symbols for asset class lookup
        const underlyingSymbols = new Set<string>();
        for (const pos of ibkrPositions) {
          if (pos.contract.secType === "OPT" && pos.pos !== 0) {
            const symbol = pos.contract.symbol || "";
            underlyingSymbols.add(symbol.split(" ")[0] || symbol);
          }
        }

        // Fetch asset class assignments
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

        // Build underlying price map from stock positions
        const underlyingPriceMap = new Map<string, number>();
        for (const pos of ibkrPositions) {
          if (pos.contract.secType === "STK" && pos.contract.symbol && pos.marketPrice != null) {
            underlyingPriceMap.set(pos.contract.symbol, pos.marketPrice);
          }
        }

        // Fetch prices for underlyings not held as stock positions
        const missingSymbols = Array.from(underlyingSymbols).filter(s => !underlyingPriceMap.has(s));
        if (missingSymbols.length > 0) {
          const pricePromises = missingSymbols.map(async (symbol) => {
            try {
              const data = await ibkrService.getMarketData({
                symbol,
                secType: SecType.STK,
                exchange: "SMART",
                currency: "USD",
              });
              const price = data?.last ?? data?.close;
              if (price != null && price > 0) {
                underlyingPriceMap.set(symbol, price);
              }
            } catch {
              // Skip - price will remain missing
            }
          });
          await Promise.all(pricePromises);
        }

        for (const pos of ibkrPositions) {
          if (pos.contract.secType !== "OPT") continue;
          if (pos.pos === 0) continue;

          const expiryStr = pos.contract.lastTradeDateOrContractMonth;
          if (!expiryStr) continue;

          const expiry = this.parseContractExpiry(expiryStr);
          if (!expiry) continue;

          // NOTE: No month filter — include all expiry months

          const strike = pos.contract.strike || 0;
          const right = (pos.contract.right || "C") as "C" | "P";
          const costBasis = pos.avgCost * Math.abs(pos.pos);
          const marketValue = pos.marketValue || 0;

          const unrealizedPnl = pos.pos < 0
            ? costBasis + marketValue
            : marketValue - costBasis;

          let projectedProfit = 0;
          if (pos.pos < 0) {
            projectedProfit = costBasis;
          }

          const symbol = pos.contract.symbol || "";
          const underlying = symbol.split(" ")[0] || symbol;
          const assignment = assignmentMap.get(underlying);

          positions.push({
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
            underlyingPrice: underlyingPriceMap.get(underlying),
            assetClassId: assignment?.assetClassId,
            assetClassName: assignment?.assetClass.name,
            assetClassColor: assignment?.assetClass.color,
          });
        }
      } catch {
        // IBKR not connected, return empty
      }
    }

    // Sort by expiry ascending (nearest first)
    positions.sort((a, b) => a.expiry.localeCompare(b.expiry));

    const totalUnrealized = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const totalProjected = positions.reduce((sum, p) => sum + p.projectedProfit, 0);

    return { totalUnrealized, totalProjected, positions };
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

        // Build underlying price map from stock positions
        const underlyingPriceMap = new Map<string, number>();
        for (const pos of positions) {
          if (pos.contract.secType === "STK" && pos.contract.symbol && pos.marketPrice != null) {
            underlyingPriceMap.set(pos.contract.symbol, pos.marketPrice);
          }
        }

        // Fetch prices for underlyings not held as stock positions
        const missingSymbols = Array.from(underlyingSymbols).filter(s => !underlyingPriceMap.has(s));
        if (missingSymbols.length > 0) {
          const pricePromises = missingSymbols.map(async (symbol) => {
            try {
              const data = await ibkrService.getMarketData({
                symbol,
                secType: SecType.STK,
                exchange: "SMART",
                currency: "USD",
              });
              const price = data?.last ?? data?.close;
              if (price != null && price > 0) {
                underlyingPriceMap.set(symbol, price);
              }
            } catch {
              // Skip - price will remain missing
            }
          });
          await Promise.all(pricePromises);
        }

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
            underlyingPrice: underlyingPriceMap.get(underlying),
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
        withholdingTax: detail.summary.withholdingTax,
        fees: detail.summary.fees,
        total: detail.summary.total,
        closedTrades: detail.realized.optionTrades,
        stockTrades: detail.realized.stockTrades,
        cashTransactions: [
          ...detail.realized.dividends,
          ...detail.realized.interest,
          ...detail.realized.withholdingTax,
          ...detail.realized.fees,
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
   * and pair open/close trades - delegates to shared tradeMatching module
   */
  private groupOptionTrades(
    trades: OptionTradeInput[],
    assignmentMap?: AssetClassMap
  ): OptionTradeGroup[] {
    return groupOptionTrades(trades, assignmentMap);
  }

  /**
   * Group stock trades for display - uses IBKR's realizedPnl directly instead of FIFO matching
   * Returns only sell trades (realized P&L)
   */
  private groupStockTrades(
    trades: StockTradeInput[],
    assignmentMap?: AssetClassMap
  ): StockTradeGroup[] {
    return groupStockTrades(trades, assignmentMap);
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
   * Fetch today's option executions from TWS
   */
  async getTodayExecutions(): Promise<ImportedTrade[]> {
    return ibkrService.getTodayTrades("OPT");
  }

  /**
   * Fetch today's stock executions from TWS and calculate realizedPnl from cost basis
   */
  async getTodayStockExecutions(): Promise<ImportedTrade[]> {
    const stockTrades = await ibkrService.getTodayTrades("STK");
    if (stockTrades.length === 0) {
      return [];
    }

    // For SELL trades, calculate realizedPnl from cost basis
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
      existing.totalCost += Math.abs(buy.quantity) * buy.tradePrice - buy.commission;
      costBasisMap.set(buy.symbol, existing);
    }

    // Calculate realizedPnl for each sell trade
    for (const sell of sellTrades) {
      const costInfo = costBasisMap.get(sell.symbol);
      if (costInfo && costInfo.totalQty > 0) {
        const avgCostPerShare = costInfo.totalCost / costInfo.totalQty;
        const sellQty = Math.abs(sell.quantity);
        const costBasis = avgCostPerShare * sellQty;
        const sellProceeds = sellQty * sell.tradePrice + sell.commission;
        sell.costBasis = costBasis;
        sell.realizedPnl = sellProceeds - costBasis;
      }
    }

    return stockTrades;
  }
}

export const profitService = new ProfitService();
