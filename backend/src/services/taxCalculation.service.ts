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
          tradeDate: { lt: close.tradeDate },
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
            tradeDate: { lt: close.tradeDate },
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
            tradeDate: { lt: close.tradeDate },
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

      const proceedsUsd = close.proceeds || 0;
      const costBasisUsd = Math.abs(close.costBasis || 0);
      const pnlUsd = close.realizedPnl || proceedsUsd - costBasisUsd;

      const proceedsCzk = rate ? proceedsUsd * rate : 0;
      const costBasisCzk = rate ? costBasisUsd * rate : 0;
      const pnlCzk = rate ? pnlUsd * rate : 0;

      // Determine close type
      let closeType: "closed" | "expired" | "assigned" = "closed";
      if (close.wasAssigned) {
        closeType = "assigned";
      } else if (proceedsUsd === 0 && costBasisUsd === 0) {
        closeType = "expired";
      }

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
        proceedsUsd,
        costBasisUsd,
        pnlUsd,
        rate: rate || 0,
        proceedsCzk,
        costBasisCzk,
        pnlCzk,
        status: open ? "complete" : "missing_open",
        currency: close.currency || "USD",
      };

      trades.push(trade);

      if (trade.status === "complete") {
        if (proceedsCzk > 0) totalIncome += proceedsCzk;
        if (costBasisCzk > 0) totalExpenses += costBasisCzk;
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

    const dividends: TaxDividend[] = [];
    const countryTotals: Map<
      string,
      { gross: number; withholdingTax: number; count: number }
    > = new Map();

    for (const div of dividendTxns) {
      const rate = await cnbExchangeRateService.getRate(
        div.transactionDate,
        div.currency || "USD"
      );

      // Find matching withholding tax (same symbol, close date)
      const withholding = withholdingTxns.find(
        (w) =>
          w.symbol === div.symbol &&
          Math.abs(
            w.transactionDate.getTime() - div.transactionDate.getTime()
          ) <
            7 * 24 * 60 * 60 * 1000 // Within 7 days
      );

      const grossUsd = div.amount || 0;
      const withholdingTaxUsd = Math.abs(withholding?.amount || 0);
      const netUsd = grossUsd - withholdingTaxUsd;

      // Extract country from ISIN or description (first 2 chars of ISIN)
      const country = this.extractCountry(div.description || "", div.symbol);

      const dividend: TaxDividend = {
        id: div.id,
        date: div.transactionDate.toISOString().split("T")[0],
        symbol: div.symbol || "",
        country,
        grossUsd,
        withholdingTaxUsd,
        netUsd,
        rate: rate || 0,
        grossCzk: rate ? grossUsd * rate : 0,
        withholdingTaxCzk: rate ? withholdingTaxUsd * rate : 0,
        netCzk: rate ? netUsd * rate : 0,
        currency: div.currency || "USD",
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
