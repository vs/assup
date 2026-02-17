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
  LotTraceResponse,
  LotTraceEntry,
  ConsumedLot,
  OptionLotTraceResponse,
  OptionLotTraceEntry,
  OptionConsumedLot,
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
   *
   * Uses proper FIFO (First In, First Out) matching:
   * 1. Get all BUY trades for each symbol with their CZK exchange rates
   * 2. Process all SELL trades chronologically to consume lots in FIFO order
   * 3. Calculate CZK cost basis from actual consumed lots (each with its own exchange rate)
   *
   * Example: If you bought 100 shares on Jan 1 2020 and 100 on Jun 1 2020,
   * then sold 100 on Jan 1 2021, the 2021 sell consumes the Jan 2020 lot.
   * A subsequent sell in 2025 would use the Jun 2020 lot's cost basis and rate.
   */
  async getStockTrades(year: number): Promise<{
    trades: TaxStockTrade[];
    totals: { income: number; expenses: number; profit: number };
  }> {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    // Get all unique symbols that had sells in this year
    const sellsThisYear = await prisma.importedTrade.findMany({
      where: {
        secType: "STK",
        buySell: "SELL",
        tradeDate: {
          gte: yearStart,
          lte: yearEnd,
        },
      },
      select: { symbol: true },
      distinct: ["symbol"],
    });

    const symbols = sellsThisYear.map((s) => s.symbol);
    const trades: TaxStockTrade[] = [];
    let totalIncome = 0;
    let totalExpenses = 0;

    // Process each symbol separately to maintain proper FIFO ordering
    for (const symbol of symbols) {
      const symbolTrades = await this.processSymbolFifo(
        symbol,
        yearStart,
        yearEnd
      );

      for (const trade of symbolTrades) {
        trades.push(trade);

        if (!trade.isExempt && trade.status === "complete") {
          totalIncome += trade.proceedsCzk;
          totalExpenses += trade.costBasisCzk || 0;
        }
      }
    }

    // Sort all trades by date
    trades.sort((a, b) => a.dateClosed.localeCompare(b.dateClosed));

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
   * Process FIFO matching for a single symbol
   * Returns TaxStockTrade records for sells within the target year
   */
  private async processSymbolFifo(
    symbol: string,
    yearStart: Date,
    yearEnd: Date
  ): Promise<TaxStockTrade[]> {
    // Get all buys for this symbol (ever) - these are our lots
    const buys = await prisma.importedTrade.findMany({
      where: {
        symbol,
        secType: "STK",
        buySell: "BUY",
      },
      orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
    });

    // Get all sells up to and including the target year
    // We need to process ALL sells chronologically to properly consume lots
    const sells = await prisma.importedTrade.findMany({
      where: {
        symbol,
        secType: "STK",
        buySell: "SELL",
        tradeDate: { lte: yearEnd },
      },
      orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
    });

    // Build buy lots with their CZK exchange rates
    interface BuyLot {
      id: string;
      tradeDate: Date;
      originalQty: number;
      remainingQty: number;
      pricePerShare: number;
      commission: number;
      exchangeRate: number;
      currency: string;
    }

    const lots: BuyLot[] = [];
    for (const buy of buys) {
      const qty = Math.abs(buy.quantity);
      const rate = await cnbExchangeRateService.getRate(
        buy.tradeDate,
        buy.currency || "USD"
      );
      lots.push({
        id: buy.id,
        tradeDate: buy.tradeDate,
        originalQty: qty,
        remainingQty: qty,
        pricePerShare: buy.tradePrice,
        commission: buy.commission,
        exchangeRate: rate || 0,
        currency: buy.currency || "USD",
      });
    }

    const result: TaxStockTrade[] = [];
    const THREE_YEARS_DAYS = 3 * 365;

    // Process each sell in chronological order (FIFO)
    for (const sell of sells) {
      const sellQty = Math.abs(sell.quantity);
      let qtyRemaining = sellQty;

      // Track consumed lots separately by exemption status
      // This allows partial exemption when a sale spans lots with different holding periods
      interface ConsumedPortion {
        qty: number;
        costBasisUsd: number;
        costBasisCzk: number;
        buyDate: Date;
        holdingDays: number;
      }

      const exemptPortions: ConsumedPortion[] = [];
      const taxablePortions: ConsumedPortion[] = [];
      let missingQty = 0;

      // Consume from oldest lots first (FIFO)
      for (const lot of lots) {
        if (qtyRemaining <= 0) break;
        if (lot.remainingQty <= 0) continue;

        const qtyToConsume = Math.min(qtyRemaining, lot.remainingQty);

        // Calculate proportional cost basis for this portion
        // Cost = (qty × price) + (commission × proportion of original lot)
        const proportionOfLot = qtyToConsume / lot.originalQty;
        const lotCostUsd =
          qtyToConsume * lot.pricePerShare + lot.commission * proportionOfLot;
        const lotCostCzk = lotCostUsd * lot.exchangeRate;

        // Calculate holding period for this specific lot
        const holdingDays = Math.floor(
          (sell.tradeDate.getTime() - lot.tradeDate.getTime()) /
            (1000 * 60 * 60 * 24)
        );

        const portion: ConsumedPortion = {
          qty: qtyToConsume,
          costBasisUsd: lotCostUsd,
          costBasisCzk: lotCostCzk,
          buyDate: lot.tradeDate,
          holdingDays,
        };

        // Separate into exempt (3+ years) and taxable portions
        if (holdingDays >= THREE_YEARS_DAYS) {
          exemptPortions.push(portion);
        } else {
          taxablePortions.push(portion);
        }

        // Consume from this lot
        lot.remainingQty -= qtyToConsume;
        qtyRemaining -= qtyToConsume;
      }

      // Track any quantity without matching buys
      if (qtyRemaining > 0) {
        missingQty = qtyRemaining;
      }

      // Only output trades within the target year
      const isInYear = sell.tradeDate >= yearStart && sell.tradeDate <= yearEnd;
      if (!isInYear) continue;

      const closeRate = await cnbExchangeRateService.getRate(
        sell.tradeDate,
        sell.currency || "USD"
      );

      const totalProceedsUsd = sell.proceeds || 0;

      // Helper to create a TaxStockTrade from portions
      const createTrade = (
        portions: ConsumedPortion[],
        isExempt: boolean,
        idSuffix: string
      ): TaxStockTrade | null => {
        if (portions.length === 0) return null;

        const totalQty = portions.reduce((sum, p) => sum + p.qty, 0);
        const costBasisUsd = portions.reduce((sum, p) => sum + p.costBasisUsd, 0);
        const costBasisCzk = portions.reduce((sum, p) => sum + p.costBasisCzk, 0);

        // Allocate proceeds proportionally by quantity
        const proceedsProportion = totalQty / sellQty;
        const proceedsUsd = totalProceedsUsd * proceedsProportion;
        const proceedsCzk = closeRate ? proceedsUsd * closeRate : 0;

        // Use earliest buy date for display (oldest lot consumed)
        const earliestBuyDate = portions.reduce(
          (earliest, p) => (p.buyDate < earliest ? p.buyDate : earliest),
          portions[0].buyDate
        );

        // Use the minimum holding days for conservative display
        const minHoldingDays = Math.min(...portions.map((p) => p.holdingDays));

        return {
          id: `${sell.id}${idSuffix}`,
          symbol: sell.symbol,
          quantity: totalQty,
          dateOpened: earliestBuyDate.toISOString().split("T")[0],
          dateClosed: sell.tradeDate.toISOString().split("T")[0],
          holdingDays: minHoldingDays,
          isExempt,
          proceedsUsd,
          costBasisUsd,
          pnlUsd: proceedsUsd - costBasisUsd,
          rateOpen: null, // No single rate when FIFO may consume multiple lots
          rateClosed: closeRate || 0,
          proceedsCzk,
          costBasisCzk,
          pnlCzk: proceedsCzk - costBasisCzk,
          status: "complete",
          currency: sell.currency || "USD",
        };
      };

      // Create separate records for exempt and taxable portions
      const exemptTrade = createTrade(exemptPortions, true, "-exempt");
      const taxableTrade = createTrade(taxablePortions, false, "-taxable");

      if (exemptTrade) result.push(exemptTrade);
      if (taxableTrade) result.push(taxableTrade);

      // If there's missing quantity (no matching buys), create a missing_buy record
      if (missingQty > 0) {
        const proceedsProportion = missingQty / sellQty;
        const proceedsUsd = totalProceedsUsd * proceedsProportion;
        const proceedsCzk = closeRate ? proceedsUsd * closeRate : 0;

        result.push({
          id: `${sell.id}-missing`,
          symbol: sell.symbol,
          quantity: missingQty,
          dateOpened: null,
          dateClosed: sell.tradeDate.toISOString().split("T")[0],
          holdingDays: null,
          isExempt: false,
          proceedsUsd,
          costBasisUsd: 0,
          pnlUsd: proceedsUsd,
          rateOpen: null,
          rateClosed: closeRate || 0,
          proceedsCzk,
          costBasisCzk: null,
          pnlCzk: null,
          status: "missing_buy",
          currency: sell.currency || "USD",
        });
      }
    }

    return result;
  }

  /**
   * Get option trades with CZK conversion for tax reporting
   * Uses FIFO matching and converts each trade using its own date's exchange rate
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

    // Group closes by symbol to process FIFO per contract
    const closesBySymbol = new Map<string, typeof closes>();
    for (const close of closes) {
      const existing = closesBySymbol.get(close.symbol) || [];
      existing.push(close);
      closesBySymbol.set(close.symbol, existing);
    }

    const trades: TaxOptionTrade[] = [];
    let totalIncome = 0;
    let totalExpenses = 0;

    const STRIKE_TOLERANCE_PERCENT = 0.02;
    const STRIKE_TOLERANCE_ABS = 1.0;

    // Process each symbol separately for proper FIFO tracking
    for (const [symbol, symbolCloses] of closesBySymbol) {
      // Get all opens for this symbol (including before the year for FIFO)
      let opens = await prisma.importedTrade.findMany({
        where: {
          symbol,
          secType: "OPT",
          openClose: "O",
        },
        orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
      });

      // Try relaxed matching if no opens found
      if (opens.length === 0 && symbolCloses.length > 0) {
        const sampleClose = symbolCloses[0];

        if (sampleClose.conId) {
          opens = await prisma.importedTrade.findMany({
            where: {
              conId: sampleClose.conId,
              secType: "OPT",
              openClose: "O",
            },
            orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
          });
        }

        if (opens.length === 0 && sampleClose.underlying && sampleClose.expiry && sampleClose.right) {
          const potentialOpens = await prisma.importedTrade.findMany({
            where: {
              underlying: sampleClose.underlying,
              expiry: sampleClose.expiry,
              right: sampleClose.right,
              secType: "OPT",
              openClose: "O",
            },
            orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
          });

          for (const candidate of potentialOpens) {
            if (candidate.strike && sampleClose.strike) {
              const strikeDiff = Math.abs(candidate.strike - sampleClose.strike);
              const percentDiff = sampleClose.strike > 0 ? strikeDiff / sampleClose.strike : 0;
              if (strikeDiff <= STRIKE_TOLERANCE_ABS || percentDiff <= STRIKE_TOLERANCE_PERCENT) {
                opens.push(candidate);
              }
            }
          }
        }
      }

      // Build lot tracking with exchange rates
      interface LotInfo {
        id: string;
        tradeDate: Date;
        originalQty: number;
        remainingQty: number;
        premiumPerContract: number;
        totalPremium: number;
        exchangeRate: number;
        currency: string;
        isShort: boolean; // SELL to open = short
      }

      const lots: LotInfo[] = [];
      for (const open of opens) {
        const qty = Math.abs(open.quantity);
        const rate = await cnbExchangeRateService.getRate(
          open.tradeDate,
          open.currency || "USD"
        );
        const totalPremium = Math.abs(open.proceeds || 0);
        const premiumPerContract = qty > 0 ? totalPremium / qty : 0;

        lots.push({
          id: open.id,
          tradeDate: open.tradeDate,
          originalQty: qty,
          remainingQty: qty,
          premiumPerContract,
          totalPremium,
          exchangeRate: rate || 0,
          currency: open.currency || "USD",
          isShort: open.buySell === "SELL",
        });
      }

      // Get all closes for this symbol to process in order (including before year for FIFO state)
      const allCloses = await prisma.importedTrade.findMany({
        where: {
          symbol,
          secType: "OPT",
          openClose: "C",
        },
        orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
      });

      // Process all closes to maintain FIFO state
      for (const close of allCloses) {
        const closeQty = Math.abs(close.quantity);
        const closeRate = await cnbExchangeRateService.getRate(
          close.tradeDate,
          close.currency || "USD"
        );
        const closePremium = Math.abs(close.proceeds || 0);
        const closePremiumPerContract = closeQty > 0 ? closePremium / closeQty : 0;

        // Determine close type
        let closeType: "closed" | "expired" | "assigned" = "closed";
        const isAssigned = close.wasAssigned || (close.proceeds === 0 && (close.costBasis || 0) > 0);
        if (isAssigned) {
          closeType = "assigned";
        } else if (close.proceeds === 0 && (close.costBasis || 0) === 0) {
          closeType = "expired";
        }

        // FIFO matching - consume from oldest lots
        let qtyRemaining = closeQty;
        let incomeUsd = 0;
        let expenseUsd = 0;
        let incomeCzk = 0;
        let expenseCzk = 0;
        let hasMatchingOpen = false;

        for (const lot of lots) {
          if (qtyRemaining <= 0) break;
          if (lot.remainingQty <= 0) continue;
          if (lot.tradeDate > close.tradeDate) continue; // Can't close before opening

          hasMatchingOpen = true;
          const qtyToConsume = Math.min(qtyRemaining, lot.remainingQty);
          const proportionOfClose = qtyToConsume / closeQty;

          // Calculate premiums for this lot portion
          const openPremiumUsd = lot.premiumPerContract * qtyToConsume;
          const openPremiumCzk = openPremiumUsd * lot.exchangeRate;
          const closePremiumUsdPortion = closePremiumPerContract * qtyToConsume;
          const closePremiumCzkPortion = closePremiumUsdPortion * (closeRate || 0);

          // Czech tax: Income = money received, Expense = money paid
          // Short position (SELL to open): received premium at open, pay to close
          // Long position (BUY to open): pay premium at open, receive at close
          if (lot.isShort) {
            // Short: received at open (income), paid at close (expense)
            if (closeType === "assigned" || closeType === "expired") {
              // Assigned/expired: only the open premium counts
              incomeUsd += openPremiumUsd;
              incomeCzk += openPremiumCzk;
            } else {
              incomeUsd += openPremiumUsd;
              incomeCzk += openPremiumCzk;
              expenseUsd += closePremiumUsdPortion;
              expenseCzk += closePremiumCzkPortion;
            }
          } else {
            // Long: paid at open (expense), received at close (income)
            if (closeType === "expired") {
              // Expired worthless: only the expense counts
              expenseUsd += openPremiumUsd;
              expenseCzk += openPremiumCzk;
            } else if (closeType === "assigned") {
              // Assigned: premium paid is expense (stock transaction separate)
              expenseUsd += openPremiumUsd;
              expenseCzk += openPremiumCzk;
            } else {
              expenseUsd += openPremiumUsd;
              expenseCzk += openPremiumCzk;
              incomeUsd += closePremiumUsdPortion;
              incomeCzk += closePremiumCzkPortion;
            }
          }

          lot.remainingQty -= qtyToConsume;
          qtyRemaining -= qtyToConsume;
        }

        // Only add to trades list if this close is in the target year
        const closeDate = close.tradeDate;
        if (closeDate >= startDate && closeDate <= endDate) {
          const pnlUsd = incomeUsd - expenseUsd;
          const pnlCzk = incomeCzk - expenseCzk;

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
            quantity: closeQty,
            closeType,
            dateClosed: close.tradeDate.toISOString().split("T")[0],
            proceedsUsd: incomeUsd,
            costBasisUsd: expenseUsd,
            pnlUsd,
            rate: closeRate || 0,
            proceedsCzk: incomeCzk,
            costBasisCzk: expenseCzk,
            pnlCzk,
            status: hasMatchingOpen ? "complete" : "missing_open",
            currency: close.currency || "USD",
          };

          trades.push(trade);

          if (trade.status === "complete") {
            totalIncome += incomeCzk;
            totalExpenses += expenseCzk;
          }
        }
      }
    }

    // Sort trades by date
    trades.sort((a, b) => a.dateClosed.localeCompare(b.dateClosed));

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

  /**
   * Get FIFO lot trace for a symbol showing how buys are consumed by sells
   */
  async getLotTrace(symbol: string): Promise<LotTraceResponse> {
    const THREE_YEARS_DAYS = 3 * 365;

    // Get all buys for this symbol
    const buys = await prisma.importedTrade.findMany({
      where: {
        symbol,
        secType: "STK",
        buySell: "BUY",
      },
      orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
    });

    // Get all sells for this symbol
    const sells = await prisma.importedTrade.findMany({
      where: {
        symbol,
        secType: "STK",
        buySell: "SELL",
      },
      orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
    });

    // Build lot tracking structure
    interface LotInfo {
      id: string;
      lotRef: string;
      tradeDate: Date;
      originalQty: number;
      remainingQty: number;
      pricePerShare: number;
      commission: number;
      exchangeRate: number;
      currency: string;
      costBasisUsd: number;
      costBasisCzk: number;
    }

    const lots: LotInfo[] = [];
    const entries: LotTraceEntry[] = [];

    // Process buys first to create lots
    for (let i = 0; i < buys.length; i++) {
      const buy = buys[i];
      const qty = Math.abs(buy.quantity);
      const rate = await cnbExchangeRateService.getRate(
        buy.tradeDate,
        buy.currency || "USD"
      );
      const costBasisUsd = qty * buy.tradePrice + buy.commission;
      const costBasisCzk = costBasisUsd * (rate || 0);

      const lotInfo: LotInfo = {
        id: buy.id,
        lotRef: `lot-${i + 1}`,
        tradeDate: buy.tradeDate,
        originalQty: qty,
        remainingQty: qty,
        pricePerShare: buy.tradePrice,
        commission: buy.commission,
        exchangeRate: rate || 0,
        currency: buy.currency || "USD",
        costBasisUsd,
        costBasisCzk,
      };

      lots.push(lotInfo);
    }

    // Combine buys and sells into chronological order for processing
    interface TradeEvent {
      type: "buy" | "sell";
      date: Date;
      buyIndex?: number;
      sell?: (typeof sells)[0];
    }

    const events: TradeEvent[] = [
      ...buys.map((_, i) => ({
        type: "buy" as const,
        date: buys[i].tradeDate,
        buyIndex: i,
      })),
      ...sells.map((sell) => ({
        type: "sell" as const,
        date: sell.tradeDate,
        sell,
      })),
    ];

    // Sort by date, then buys before sells on same date
    events.sort((a, b) => {
      const dateDiff = a.date.getTime() - b.date.getTime();
      if (dateDiff !== 0) return dateDiff;
      // Buys come before sells on the same date
      if (a.type === "buy" && b.type === "sell") return -1;
      if (a.type === "sell" && b.type === "buy") return 1;
      return 0;
    });

    // Process events chronologically
    for (const event of events) {
      if (event.type === "buy" && event.buyIndex !== undefined) {
        const lot = lots[event.buyIndex];
        entries.push({
          type: "buy",
          id: lot.id,
          lotRef: lot.lotRef,
          tradeDate: lot.tradeDate.toISOString().split("T")[0],
          quantity: lot.originalQty,
          pricePerShare: lot.pricePerShare,
          exchangeRate: lot.exchangeRate,
          currency: lot.currency,
          costBasisUsd: lot.costBasisUsd,
          costBasisCzk: lot.costBasisCzk,
          remainingQty: lot.remainingQty, // Will be updated later
        });
      } else if (event.type === "sell" && event.sell) {
        const sell = event.sell;
        const sellQty = Math.abs(sell.quantity);
        let qtyRemaining = sellQty;

        const closeRate = await cnbExchangeRateService.getRate(
          sell.tradeDate,
          sell.currency || "USD"
        );
        const proceedsUsd = sell.proceeds || 0;
        const proceedsCzk = proceedsUsd * (closeRate || 0);

        const consumedLots: ConsumedLot[] = [];

        // Consume from oldest lots (FIFO)
        for (const lot of lots) {
          if (qtyRemaining <= 0) break;
          if (lot.remainingQty <= 0) continue;

          const qtyToConsume = Math.min(qtyRemaining, lot.remainingQty);

          // Calculate proportional cost basis
          const proportionOfLot = qtyToConsume / lot.originalQty;
          const lotCostUsd =
            qtyToConsume * lot.pricePerShare +
            lot.commission * proportionOfLot;
          const lotCostCzk = lotCostUsd * lot.exchangeRate;

          // Calculate proceeds proportion for this lot
          const proceedsProportion = qtyToConsume / sellQty;
          const lotProceedsUsd = proceedsUsd * proceedsProportion;
          const lotProceedsCzk = proceedsCzk * proceedsProportion;

          // Holding period
          const holdingDays = Math.floor(
            (sell.tradeDate.getTime() - lot.tradeDate.getTime()) /
              (1000 * 60 * 60 * 24)
          );

          consumedLots.push({
            lotRef: lot.lotRef,
            quantity: qtyToConsume,
            costBasisUsd: lotCostUsd,
            costBasisCzk: lotCostCzk,
            pnlUsd: lotProceedsUsd - lotCostUsd,
            pnlCzk: lotProceedsCzk - lotCostCzk,
            holdingDays,
            isExempt: holdingDays >= THREE_YEARS_DAYS,
          });

          lot.remainingQty -= qtyToConsume;
          qtyRemaining -= qtyToConsume;
        }

        entries.push({
          type: "sell",
          id: sell.id,
          lotRef: "", // Sells don't have a lotRef
          tradeDate: sell.tradeDate.toISOString().split("T")[0],
          quantity: sellQty,
          pricePerShare: sell.tradePrice,
          exchangeRate: closeRate || 0,
          currency: sell.currency || "USD",
          proceedsUsd,
          proceedsCzk,
          consumedLots,
        });
      }
    }

    // Update remainingQty on buy entries to reflect final state
    for (const entry of entries) {
      if (entry.type === "buy") {
        const lot = lots.find((l) => l.lotRef === entry.lotRef);
        if (lot) {
          entry.remainingQty = lot.remainingQty;
        }
      }
    }

    // Calculate current position
    const currentPosition = lots.reduce((sum, lot) => sum + lot.remainingQty, 0);

    return {
      symbol,
      entries,
      currentPosition,
    };
  }

  /**
   * Get FIFO lot trace for an option contract
   * @param symbol - The option symbol to trace
   */
  async getOptionLotTrace(symbol: string): Promise<OptionLotTraceResponse> {
    const STRIKE_TOLERANCE_PERCENT = 0.02;
    const STRIKE_TOLERANCE_ABS = 1.0;

    // Get all opens for this option symbol
    const opens = await prisma.importedTrade.findMany({
      where: {
        symbol,
        secType: "OPT",
        openClose: "O",
      },
      orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
    });

    // Get all closes for this option symbol
    let closes = await prisma.importedTrade.findMany({
      where: {
        symbol,
        secType: "OPT",
        openClose: "C",
      },
      orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
    });

    // If we have closes but no opens with exact symbol match, try to find opens
    // using relaxed matching (for corporate action adjusted strikes)
    if (closes.length > 0 && opens.length === 0) {
      const sampleClose = closes[0];

      // Try conId match first
      if (sampleClose.conId) {
        const conIdOpens = await prisma.importedTrade.findMany({
          where: {
            conId: sampleClose.conId,
            secType: "OPT",
            openClose: "O",
          },
          orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
        });
        opens.push(...conIdOpens);
      }

      // Try relaxed match by underlying/expiry/right with strike tolerance
      if (opens.length === 0 && sampleClose.underlying && sampleClose.expiry && sampleClose.right) {
        const potentialOpens = await prisma.importedTrade.findMany({
          where: {
            underlying: sampleClose.underlying,
            expiry: sampleClose.expiry,
            right: sampleClose.right,
            secType: "OPT",
            openClose: "O",
          },
          orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
        });

        for (const candidate of potentialOpens) {
          if (candidate.strike && sampleClose.strike) {
            const strikeDiff = Math.abs(candidate.strike - sampleClose.strike);
            const percentDiff = sampleClose.strike > 0 ? strikeDiff / sampleClose.strike : 0;
            if (strikeDiff <= STRIKE_TOLERANCE_ABS || percentDiff <= STRIKE_TOLERANCE_PERCENT) {
              opens.push(candidate);
            }
          }
        }
      }
    }

    // Build lot tracking structure
    interface LotInfo {
      id: string;
      lotRef: string;
      tradeDate: Date;
      originalQty: number;
      remainingQty: number;
      premiumPerContract: number;
      totalPremium: number;
      exchangeRate: number;
      currency: string;
      action: string;
    }

    const lots: LotInfo[] = [];
    const entries: OptionLotTraceEntry[] = [];

    // Build description from first trade
    const sampleTrade = opens[0] || closes[0];
    const strike = sampleTrade?.strike || 0;
    const right = sampleTrade?.right || "";
    const expiry = sampleTrade?.expiry
      ? sampleTrade.expiry.toISOString().split("T")[0]
      : "";
    const description = `${sampleTrade?.underlying || symbol} ${strike} ${right} ${expiry}`;

    // Process opens first to create lots
    for (let i = 0; i < opens.length; i++) {
      const open = opens[i];
      const qty = Math.abs(open.quantity);
      const rate = await cnbExchangeRateService.getRate(
        open.tradeDate,
        open.currency || "USD"
      );
      const totalPremium = open.proceeds || 0;
      const premiumPerContract = qty > 0 ? totalPremium / qty : 0;
      const action = open.buySell === "SELL" ? "SELL to open" : "BUY to open";

      const lotInfo: LotInfo = {
        id: open.id,
        lotRef: `lot-${i + 1}`,
        tradeDate: open.tradeDate,
        originalQty: qty,
        remainingQty: qty,
        premiumPerContract,
        totalPremium,
        exchangeRate: rate || 0,
        currency: open.currency || "USD",
        action,
      };

      lots.push(lotInfo);
    }

    // Combine opens and closes into chronological order for processing
    interface TradeEvent {
      type: "open" | "close";
      date: Date;
      openIndex?: number;
      close?: (typeof closes)[0];
    }

    const events: TradeEvent[] = [
      ...opens.map((_, i) => ({
        type: "open" as const,
        date: opens[i].tradeDate,
        openIndex: i,
      })),
      ...closes.map((close) => ({
        type: "close" as const,
        date: close.tradeDate,
        close,
      })),
    ];

    // Sort by date, then opens before closes on same date
    events.sort((a, b) => {
      const dateDiff = a.date.getTime() - b.date.getTime();
      if (dateDiff !== 0) return dateDiff;
      if (a.type === "open" && b.type === "close") return -1;
      if (a.type === "close" && b.type === "open") return 1;
      return 0;
    });

    // Process events chronologically
    for (const event of events) {
      if (event.type === "open" && event.openIndex !== undefined) {
        const lot = lots[event.openIndex];
        entries.push({
          type: "open",
          id: lot.id,
          lotRef: lot.lotRef,
          tradeDate: lot.tradeDate.toISOString().split("T")[0],
          quantity: lot.originalQty,
          action: lot.action,
          premiumPerContract: lot.premiumPerContract,
          totalPremium: lot.totalPremium,
          exchangeRate: lot.exchangeRate,
          totalPremiumCzk: lot.totalPremium * lot.exchangeRate,
          currency: lot.currency,
          remainingQty: lot.remainingQty, // Will be updated later
        });
      } else if (event.type === "close" && event.close) {
        const close = event.close;
        const closeQty = Math.abs(close.quantity);
        let qtyRemaining = closeQty;

        const closeRate = await cnbExchangeRateService.getRate(
          close.tradeDate,
          close.currency || "USD"
        );
        const closeProceeds = close.proceeds || 0;
        const closePremiumPerContract = closeQty > 0 ? closeProceeds / closeQty : 0;

        // Determine close type
        let closeType: "closed" | "expired" | "assigned" = "closed";
        const isAssigned = close.wasAssigned || (close.proceeds === 0 && (close.costBasis || 0) > 0);
        if (isAssigned) {
          closeType = "assigned";
        } else if (close.proceeds === 0 && (close.costBasis || 0) === 0) {
          closeType = "expired";
        }

        // Determine close action
        let closeAction = "Close";
        if (closeType === "assigned") {
          closeAction = "Assigned";
        } else if (closeType === "expired") {
          closeAction = "Expired";
        } else if (close.buySell === "BUY") {
          closeAction = "BUY to close";
        } else {
          closeAction = "SELL to close";
        }

        const consumedLots: OptionConsumedLot[] = [];

        // Consume from oldest lots (FIFO)
        for (const lot of lots) {
          if (qtyRemaining <= 0) break;
          if (lot.remainingQty <= 0) continue;

          const qtyToConsume = Math.min(qtyRemaining, lot.remainingQty);

          // Calculate proportional premiums
          const proportionOfLot = qtyToConsume / lot.originalQty;
          const openPremiumUsd = Math.abs(lot.totalPremium) * proportionOfLot;
          const openPremiumCzk = openPremiumUsd * lot.exchangeRate;

          const proportionOfClose = qtyToConsume / closeQty;
          const closePremiumUsd = Math.abs(closeProceeds) * proportionOfClose;
          const closePremiumCzk = closePremiumUsd * (closeRate || 0);

          // Calculate P&L based on position type
          // SELL to open (short): profit = premium received - premium paid to close
          // BUY to open (long): profit = premium received at close - premium paid to open
          let pnlUsd: number;
          let pnlCzk: number;
          if (lot.action === "SELL to open") {
            // Short position: received premium when opening, paid when closing
            pnlUsd = openPremiumUsd - closePremiumUsd;
            pnlCzk = openPremiumCzk - closePremiumCzk;
          } else {
            // Long position: paid premium when opening, received when closing
            pnlUsd = closePremiumUsd - openPremiumUsd;
            pnlCzk = closePremiumCzk - openPremiumCzk;
          }

          // Holding period
          const holdingDays = Math.floor(
            (close.tradeDate.getTime() - lot.tradeDate.getTime()) /
              (1000 * 60 * 60 * 24)
          );

          consumedLots.push({
            lotRef: lot.lotRef,
            quantity: qtyToConsume,
            openPremiumUsd,
            openPremiumCzk,
            closePremiumUsd,
            closePremiumCzk,
            pnlUsd,
            pnlCzk,
            holdingDays,
          });

          lot.remainingQty -= qtyToConsume;
          qtyRemaining -= qtyToConsume;
        }

        entries.push({
          type: "close",
          id: close.id,
          lotRef: "",
          tradeDate: close.tradeDate.toISOString().split("T")[0],
          quantity: closeQty,
          action: closeAction,
          premiumPerContract: closePremiumPerContract,
          totalPremium: closeProceeds,
          exchangeRate: closeRate || 0,
          totalPremiumCzk: closeProceeds * (closeRate || 0),
          currency: close.currency || "USD",
          closeType,
          consumedLots,
        });
      }
    }

    // Update remainingQty on open entries to reflect final state
    for (const entry of entries) {
      if (entry.type === "open") {
        const lot = lots.find((l) => l.lotRef === entry.lotRef);
        if (lot) {
          entry.remainingQty = lot.remainingQty;
        }
      }
    }

    // Calculate current position
    const currentPosition = lots.reduce((sum, lot) => sum + lot.remainingQty, 0);

    return {
      symbol,
      description,
      entries,
      currentPosition,
    };
  }
}

export const taxCalculationService = new TaxCalculationService();
