/**
 * Service for calculating tax data from trades and dividends
 * Converts USD to CZK using CNB exchange rates for Czech tax reporting
 */

import { prisma } from "../db/index.js";
import { cnbExchangeRateService } from "./cnbExchangeRate.service.js";
import type {
  TaxSummary,
  TaxStockTrade,
  TaxOptionTrade,
  TaxDividend,
  TaxInterest,
  DividendsByCountry,
  MissingTradeRecord,
} from "@assup/shared";

class TaxCalculationService {
  /**
   * Get complete tax summary for a year
   */
  async getSummary(year: number): Promise<TaxSummary> {
    const stockTrades = await this.getStockTrades(year);
    const optionTrades = await this.getOptionTrades(year);
    const dividends = await this.getDividends(year);
    const interest = await this.getInterest(year);

    const missingRecords: MissingTradeRecord[] = [
      ...stockTrades.trades
        .filter((t) => t.status === "missing_buy")
        .map((t) => ({
          symbol: t.symbol,
          tradeDate: t.dateClosed,
          quantity: t.quantity,
          proceeds: t.proceedsUsd,
          type: "stock" as const,
          description: `Sold ${t.quantity} shares, no buy record found`,
        })),
      ...optionTrades.trades
        .filter((t) => t.status === "missing_open")
        .map((t) => ({
          symbol: t.symbol,
          tradeDate: t.dateClosed,
          quantity: t.quantity,
          proceeds: t.proceedsUsd,
          type: "option" as const,
          description: `Closed ${t.description}, no open record found`,
        })),
    ];

    return {
      year,
      securities: {
        income: stockTrades.totals.income,
        expenses: stockTrades.totals.expenses,
        profit: stockTrades.totals.profit,
        tradeCount: stockTrades.trades.length,
        exemptCount: stockTrades.trades.filter((t) => t.isExempt).length,
      },
      derivatives: {
        income: optionTrades.totals.income,
        expenses: optionTrades.totals.expenses,
        profit: optionTrades.totals.profit,
        tradeCount: optionTrades.trades.length,
      },
      dividends: {
        gross: dividends.totals.gross,
        withholdingTax: dividends.totals.withholdingTax,
        net: dividends.totals.net,
        byCountry: dividends.byCountry,
      },
      interest: {
        total: interest.total,
        count: interest.interest.length,
      },
      missingRecords,
      canExport: missingRecords.length === 0,
    };
  }

  /**
   * Get stock trades with CZK conversion for tax reporting
   */
  async getStockTrades(year: number): Promise<{
    trades: TaxStockTrade[];
    totals: { income: number; expenses: number; profit: number };
  }> {
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31));

    // Get all stock sells in the year
    const sells = await prisma.importedTrade.findMany({
      where: {
        secType: "STK",
        buySell: "SELL",
        tradeDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { tradeDate: "asc" },
    });

    const trades: TaxStockTrade[] = [];
    let totalIncome = 0;
    let totalExpenses = 0;

    for (const sell of sells) {
      // Find matching buy
      const buy = await prisma.importedTrade.findFirst({
        where: {
          symbol: sell.symbol,
          secType: "STK",
          buySell: "BUY",
          tradeDate: { lt: sell.tradeDate },
        },
        orderBy: { tradeDate: "asc" },
      });

      const closeRate = await cnbExchangeRateService.getRate(
        sell.tradeDate,
        sell.currency || "USD"
      );

      let openRate: number | null = null;
      let holdingDays: number | null = null;
      let costBasisCzk: number | null = null;

      if (buy) {
        openRate = await cnbExchangeRateService.getRate(
          buy.tradeDate,
          buy.currency || "USD"
        );
        holdingDays = Math.floor(
          (sell.tradeDate.getTime() - buy.tradeDate.getTime()) /
            (1000 * 60 * 60 * 24)
        );
        if (openRate) {
          costBasisCzk = Math.abs(sell.costBasis || 0) * openRate;
        }
      }

      const proceedsUsd = sell.proceeds || 0;
      const costBasisUsd = Math.abs(sell.costBasis || 0);
      const proceedsCzk = closeRate ? proceedsUsd * closeRate : 0;
      const isExempt = holdingDays !== null && holdingDays >= 3 * 365;

      const trade: TaxStockTrade = {
        id: sell.id,
        symbol: sell.symbol,
        quantity: Math.abs(sell.quantity),
        dateOpened: buy?.tradeDate.toISOString().split("T")[0] || null,
        dateClosed: sell.tradeDate.toISOString().split("T")[0],
        holdingDays,
        isExempt,
        proceedsUsd,
        costBasisUsd,
        pnlUsd: proceedsUsd - costBasisUsd,
        rateOpen: openRate,
        rateClosed: closeRate || 0,
        proceedsCzk,
        costBasisCzk,
        pnlCzk: costBasisCzk !== null ? proceedsCzk - costBasisCzk : null,
        status: buy ? "complete" : "missing_buy",
        currency: sell.currency || "USD",
      };

      trades.push(trade);

      if (!isExempt && trade.status === "complete") {
        totalIncome += proceedsCzk;
        totalExpenses += costBasisCzk || 0;
      }
    }

    return {
      trades,
      totals: {
        income: totalIncome,
        expenses: totalExpenses,
        profit: totalIncome - totalExpenses,
      },
    };
  }

  /**
   * Get option trades with CZK conversion for tax reporting
   */
  async getOptionTrades(year: number): Promise<{
    trades: TaxOptionTrade[];
    totals: { income: number; expenses: number; profit: number };
  }> {
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31));

    // Get all option closes in the year
    const closes = await prisma.importedTrade.findMany({
      where: {
        secType: "OPT",
        openClose: "C",
        tradeDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { tradeDate: "asc" },
    });

    const trades: TaxOptionTrade[] = [];
    let totalIncome = 0;
    let totalExpenses = 0;

    // Strike tolerance for matching contracts adjusted by corporate actions
    const STRIKE_TOLERANCE_PERCENT = 0.02; // 2% tolerance
    const STRIKE_TOLERANCE_ABS = 1.0; // Max $1 absolute difference

    for (const close of closes) {
      // Find matching open using multiple strategies:
      // 1. Exact symbol match (fastest, works for most cases)
      // 2. conId match (most reliable, survives strike adjustments)
      // 3. Relaxed match by underlying/expiry/right with strike tolerance

      let open = await prisma.importedTrade.findFirst({
        where: {
          symbol: close.symbol,
          secType: "OPT",
          openClose: "O",
          tradeDate: { lte: close.tradeDate },
        },
        orderBy: { tradeDate: "asc" },
      });

      // If no exact match and we have conId, try matching by conId
      if (!open && close.conId) {
        open = await prisma.importedTrade.findFirst({
          where: {
            conId: close.conId,
            secType: "OPT",
            openClose: "O",
            tradeDate: { lte: close.tradeDate },
          },
          orderBy: { tradeDate: "asc" },
        });
      }

      // If still no match, try relaxed matching by underlying/expiry/right with strike tolerance
      // This handles cases where strike was adjusted due to corporate actions (e.g., special dividends)
      if (!open && close.underlying && close.expiry && close.right) {
        const potentialOpens = await prisma.importedTrade.findMany({
          where: {
            underlying: close.underlying,
            expiry: close.expiry,
            right: close.right,
            secType: "OPT",
            openClose: "O",
            tradeDate: { lte: close.tradeDate },
          },
          orderBy: { tradeDate: "asc" },
        });

        // Find one with strike within tolerance
        for (const candidate of potentialOpens) {
          if (candidate.strike && close.strike) {
            const strikeDiff = Math.abs(candidate.strike - close.strike);
            const percentDiff =
              close.strike > 0 ? strikeDiff / close.strike : 0;

            if (
              strikeDiff <= STRIKE_TOLERANCE_ABS ||
              percentDiff <= STRIKE_TOLERANCE_PERCENT
            ) {
              open = candidate;
              break;
            }
          }
        }
      }

      const rate = await cnbExchangeRateService.getRate(
        close.tradeDate,
        close.currency || "USD"
      );

      // Determine close type first to handle assigned options correctly
      let closeType: "closed" | "expired" | "assigned" = "closed";
      const isAssigned = close.wasAssigned || (close.proceeds === 0 && (close.costBasis || 0) > 0);
      if (isAssigned) {
        closeType = "assigned";
      } else if (close.proceeds === 0 && (close.costBasis || 0) === 0) {
        closeType = "expired";
      }

      // Czech tax reporting for derivatives (§10 F):
      // - Income = money received (premiums from selling options)
      // - Expense = money paid (premiums to buy options)
      //
      // IBKR FLEX data semantics for close trades:
      // - "BUY to close" (closing short options): proceeds < 0 (paid), costBasis > 0 (received earlier)
      // - "SELL to close" (closing long options): proceeds > 0 (received), costBasis < 0 (paid earlier)
      // - Assigned options: proceeds = 0, costBasis > 0 (premium received, stock deal is separate)
      // - Expired options: proceeds = 0, costBasis = 0 (worthless)
      let incomeUsd: number;
      let expenseUsd: number;
      let pnlUsd: number;

      if (isAssigned && open) {
        // Assigned option: premium received is income, no expense for the option itself
        // (the stock transaction is handled separately in securities section)
        incomeUsd = Math.abs(open.proceeds);
        expenseUsd = 0;
        pnlUsd = incomeUsd;
      } else if (closeType === "expired") {
        // Expired worthless: no income or expense from close itself
        // We need to check the original position to determine if we sold or bought
        if (open) {
          // If we sold the option (received premium), that's income with no expense
          if (open.proceeds < 0) {
            // Sold to open: received premium (proceeds is negative for sold)
            incomeUsd = Math.abs(open.proceeds);
            expenseUsd = 0;
          } else {
            // Bought to open: paid premium (now worthless)
            incomeUsd = 0;
            expenseUsd = open.proceeds;
          }
          pnlUsd = incomeUsd - expenseUsd;
        } else {
          incomeUsd = 0;
          expenseUsd = 0;
          pnlUsd = 0;
        }
      } else {
        // Regular close trade
        // For BUY to close: proceeds < 0 (expense), costBasis > 0 (income from original sale)
        // For SELL to close: proceeds > 0 (income), costBasis < 0 (expense from original purchase)
        const closeProceeds = close.proceeds || 0;
        const closeCostBasis = close.costBasis || 0;

        if (closeProceeds <= 0 && closeCostBasis >= 0) {
          // BUY to close a short position
          incomeUsd = closeCostBasis;  // Premium received when opening short
          expenseUsd = Math.abs(closeProceeds);  // Paid to close
        } else if (closeProceeds >= 0 && closeCostBasis <= 0) {
          // SELL to close a long position
          incomeUsd = closeProceeds;  // Received when closing
          expenseUsd = Math.abs(closeCostBasis);  // Paid when opening
        } else {
          // Unusual case, fall back to realized P&L if available
          incomeUsd = Math.max(0, closeProceeds, closeCostBasis);
          expenseUsd = Math.abs(Math.min(0, closeProceeds, closeCostBasis));
        }
        pnlUsd = close.realizedPnl ?? (incomeUsd - expenseUsd);
      }

      const incomeCzk = rate ? incomeUsd * rate : 0;
      const expenseCzk = rate ? expenseUsd * rate : 0;
      const pnlCzk = rate ? pnlUsd * rate : 0;

      // Build description
      const strike = close.strike || 0;
      const right = close.right || "";
      const expiry = close.expiry
        ? close.expiry.toISOString().split("T")[0]
        : "";
      const description = `${close.underlying || close.symbol} ${strike} ${right} ${expiry}`;

      const trade: TaxOptionTrade = {
        id: close.id,
        symbol: close.symbol,
        description,
        quantity: Math.abs(close.quantity),
        closeType,
        dateClosed: close.tradeDate.toISOString().split("T")[0],
        proceedsUsd: incomeUsd,
        costBasisUsd: expenseUsd,
        pnlUsd,
        rate: rate || 0,
        proceedsCzk: incomeCzk,
        costBasisCzk: expenseCzk,
        pnlCzk,
        status: open ? "complete" : "missing_open",
        currency: close.currency || "USD",
      };

      trades.push(trade);

      if (trade.status === "complete") {
        totalIncome += incomeCzk;
        totalExpenses += expenseCzk;
      }
    }

    return {
      trades,
      totals: {
        income: totalIncome,
        expenses: totalExpenses,
        profit: totalIncome - totalExpenses,
      },
    };
  }

  /**
   * Get dividends with CZK conversion for tax reporting
   * Aggregates dividends and withholding taxes by symbol+date to handle reversals
   */
  async getDividends(year: number): Promise<{
    dividends: TaxDividend[];
    byCountry: DividendsByCountry[];
    totals: { gross: number; withholdingTax: number; net: number };
  }> {
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31));

    // Get dividends
    const dividendTxns = await prisma.cashTransaction.findMany({
      where: {
        type: "DIVIDEND",
        transactionDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { transactionDate: "asc" },
    });

    // Get withholding taxes
    const withholdingTxns = await prisma.cashTransaction.findMany({
      where: {
        type: "WITHHOLDING_TAX",
        transactionDate: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    // Aggregate dividends by symbol+date to handle reversals
    // (e.g., a reversal of -5.97 and a re-payment of +5.97 should net to one entry)
    const dividendAggregates = new Map<
      string,
      {
        id: string;
        symbol: string;
        date: Date;
        amount: number;
        currency: string;
        description: string;
      }
    >();

    for (const div of dividendTxns) {
      const dateKey = div.transactionDate.toISOString().split("T")[0];
      const key = `${div.symbol || ""}:${dateKey}`;

      const existing = dividendAggregates.get(key);
      if (existing) {
        existing.amount += div.amount || 0;
      } else {
        dividendAggregates.set(key, {
          id: div.id,
          symbol: div.symbol || "",
          date: div.transactionDate,
          amount: div.amount || 0,
          currency: div.currency || "USD",
          description: div.description || "",
        });
      }
    }

    // Aggregate withholding taxes by symbol+date to handle reversals
    const withholdingAggregates = new Map<string, number>();
    for (const wh of withholdingTxns) {
      const dateKey = wh.transactionDate.toISOString().split("T")[0];
      const key = `${wh.symbol || ""}:${dateKey}`;

      const existing = withholdingAggregates.get(key) || 0;
      withholdingAggregates.set(key, existing + (wh.amount || 0));
    }

    const dividends: TaxDividend[] = [];
    const countryTotals: Map<
      string,
      { gross: number; withholdingTax: number; count: number }
    > = new Map();

    for (const [key, div] of dividendAggregates) {
      // Skip if the aggregated dividend is zero (fully reversed)
      if (Math.abs(div.amount) < 0.01) {
        continue;
      }

      const rate = await cnbExchangeRateService.getRate(
        div.date,
        div.currency || "USD"
      );

      // Find matching aggregated withholding tax (same symbol+date)
      const withholdingAmount = withholdingAggregates.get(key) || 0;
      // Withholding taxes are stored as negative, so we negate to get positive amount
      // But if the dividend is negative (reversal), the withholding should also remain negative
      const withholdingTaxUsd = -withholdingAmount;

      const grossUsd = div.amount;
      const netUsd = grossUsd - withholdingTaxUsd;

      // Extract country from ISIN or description (first 2 chars of ISIN)
      const country = this.extractCountry(div.description, div.symbol);

      const dividend: TaxDividend = {
        id: div.id,
        date: div.date.toISOString().split("T")[0],
        symbol: div.symbol,
        country,
        grossUsd,
        withholdingTaxUsd,
        netUsd,
        rate: rate || 0,
        grossCzk: rate ? grossUsd * rate : 0,
        withholdingTaxCzk: rate ? withholdingTaxUsd * rate : 0,
        netCzk: rate ? netUsd * rate : 0,
        currency: div.currency,
      };

      dividends.push(dividend);

      // Accumulate by country
      const existing = countryTotals.get(country) || {
        gross: 0,
        withholdingTax: 0,
        count: 0,
      };
      countryTotals.set(country, {
        gross: existing.gross + dividend.grossCzk,
        withholdingTax: existing.withholdingTax + dividend.withholdingTaxCzk,
        count: existing.count + 1,
      });
    }

    const byCountry: DividendsByCountry[] = Array.from(
      countryTotals.entries()
    ).map(([country, data]) => ({
      country,
      gross: data.gross,
      withholdingTax: data.withholdingTax,
      net: data.gross - data.withholdingTax,
      count: data.count,
    }));

    const totals = {
      gross: byCountry.reduce((sum, c) => sum + c.gross, 0),
      withholdingTax: byCountry.reduce((sum, c) => sum + c.withholdingTax, 0),
      net: byCountry.reduce((sum, c) => sum + c.net, 0),
    };

    return { dividends, byCountry, totals };
  }

  /**
   * Get interest payments with CZK conversion for tax reporting
   */
  async getInterest(year: number): Promise<{
    interest: TaxInterest[];
    total: number;
  }> {
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31));

    const interestTxns = await prisma.cashTransaction.findMany({
      where: {
        type: "INTEREST",
        transactionDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { transactionDate: "asc" },
    });

    const interest: TaxInterest[] = [];
    let total = 0;

    for (const txn of interestTxns) {
      const currency = txn.currency || "USD";
      const amount = txn.amount || 0;

      // CZK amounts don't need conversion
      let rate: number;
      let amountCzk: number;
      if (currency === "CZK") {
        rate = 1;
        amountCzk = amount;
      } else {
        rate = await cnbExchangeRateService.getRate(txn.transactionDate, currency) || 0;
        amountCzk = amount * rate;
      }

      interest.push({
        id: txn.id,
        date: txn.transactionDate.toISOString().split("T")[0],
        description: txn.description || "",
        amountUsd: amount,
        rate,
        amountCzk,
        currency,
      });

      total += amountCzk;
    }

    return { interest, total };
  }

  /**
   * Extract country from dividend description or symbol
   */
  private extractCountry(description: string, symbol: string | null): string {
    // Try to extract from ISIN in description (e.g., "USZ363198954")
    const isinMatch = description.match(/\b([A-Z]{2})\d{9,10}\b/);
    if (isinMatch) {
      return this.isinCountryToName(isinMatch[1]);
    }

    // Default heuristics based on common symbols
    // This is simplified - in production you'd use a proper mapping
    return "USA"; // Default to USA for IBKR accounts
  }

  private isinCountryToName(code: string): string {
    const countryMap: Record<string, string> = {
      US: "USA",
      DE: "Germany",
      GB: "United Kingdom",
      IE: "Ireland",
      FR: "France",
      NL: "Netherlands",
      CH: "Switzerland",
      CA: "Canada",
      JP: "Japan",
      AU: "Australia",
    };
    return countryMap[code] || code;
  }
}

export const taxCalculationService = new TaxCalculationService();
