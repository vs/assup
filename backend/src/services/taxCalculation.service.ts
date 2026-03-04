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
  AffectedLot,
  OptionLotTraceResponse,
  OptionLotTraceEntry,
  OptionConsumedLot,
} from "@assup/shared";

class TaxCalculationService {
  private static readonly VALUE_TEST_THRESHOLD = 100_000;

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
      valueTest: {
        grossProceedsCzk: stockTrades.grossProceedsCzk,
        thresholdCzk: TaxCalculationService.VALUE_TEST_THRESHOLD,
        isExempt:
          stockTrades.grossProceedsCzk <
          TaxCalculationService.VALUE_TEST_THRESHOLD,
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
    grossProceedsCzk: number;
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

    // Calculate gross proceeds for Value Test (all complete trades, including 3yr exempt)
    const grossProceedsCzk = trades
      .filter((t) => t.status === "complete")
      .reduce((sum, t) => sum + t.proceedsCzk, 0);

    return {
      trades,
      totals: {
        income: totalIncome,
        expenses: totalExpenses,
        profit: totalIncome - totalExpenses,
      },
      grossProceedsCzk,
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

    // Get all buys for this symbol (ever) - these are our lots
    let buys = await prisma.importedTrade.findMany({
      where: {
        symbol,
        secType: "STK",
        buySell: "BUY",
      },
      orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
    });

    // If no buys found by symbol, try conId fallback (handles ticker changes like ZOK -> QZEU)
    if (buys.length === 0 && sells.length > 0) {
      const sampleSell = sells[0];
      if (sampleSell.conId) {
        buys = await prisma.importedTrade.findMany({
          where: {
            conId: sampleSell.conId,
            secType: "STK",
            buySell: "BUY",
          },
          orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
        });
      }
    }

    // Get stock splits for this symbol (forward splits and stock dividends)
    const splits = await prisma.corporateAction.findMany({
      where: {
        symbol,
        actionType: { in: ["FS", "SD"] }, // Forward split or stock dividend
        splitRatio: { not: null },
      },
      orderBy: { exDate: "asc" },
    });

    // Build buy lots with their CZK exchange rates
    interface BuyLot {
      id: string;
      tradeDate: Date;
      originalQty: number;
      remainingQty: number;
      totalCostUsd: number; // Total cost including commission (from IBKR proceeds)
      exchangeRate: number;
      currency: string;
      splitMultiplier: number; // Cumulative split multiplier applied to this lot
      wasFromAssignment: boolean; // True if this buy came from PUT assignment
    }

    const lots: BuyLot[] = [];
    for (const buy of buys) {
      const qty = Math.abs(buy.quantity);
      const rate = await cnbExchangeRateService.getRate(
        buy.tradeDate,
        buy.currency || "USD"
      );

      // Check if this BUY came from a PUT assignment
      const assignedStrike = await this.findAssignedPutStrike(
        symbol,
        buy.tradeDate,
        buy.quantity
      );

      let totalCostUsd: number;
      let wasFromAssignment = false;

      if (assignedStrike !== null) {
        // Assigned stock: use Strike × Quantity (actual cash paid)
        // NOT IBKR's adjusted basis which has premium subtracted
        totalCostUsd = assignedStrike * qty - buy.commission;
        wasFromAssignment = true;
      } else {
        // Normal purchase: use IBKR proceeds + commission for cost basis
        // This handles bonds correctly where tradePrice is a percentage of face value
        totalCostUsd = Math.abs(buy.proceeds || 0) - buy.commission;
      }

      // Calculate cumulative split multiplier for this lot
      // Only count splits that occurred AFTER the buy date
      let splitMultiplier = 1;
      for (const split of splits) {
        if (split.exDate > buy.tradeDate && split.splitRatio) {
          splitMultiplier *= split.splitRatio;
        }
      }

      // Apply split multiplier to quantity (cost basis stays the same)
      const adjustedQty = qty * splitMultiplier;

      lots.push({
        id: buy.id,
        tradeDate: buy.tradeDate,
        originalQty: adjustedQty,
        remainingQty: adjustedQty,
        totalCostUsd,
        exchangeRate: rate || 0,
        currency: buy.currency || "USD",
        splitMultiplier,
        wasFromAssignment,
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
        wasFromAssignment: boolean;
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
        const proportionOfLot = qtyToConsume / lot.originalQty;
        const lotCostUsd = lot.totalCostUsd * proportionOfLot;
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
          wasFromAssignment: lot.wasFromAssignment,
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

        // Mark as from assignment if any consumed lot was from assignment
        const wasFromAssignment = portions.some((p) => p.wasFromAssignment);

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
          wasFromAssignment: wasFromAssignment || undefined,
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
   * Find assigned PUT option that resulted in a stock BUY trade
   * Returns strike price if found, null otherwise
   */
  private async findAssignedPutStrike(
    symbol: string,
    buyDate: Date,
    quantity: number
  ): Promise<number | null> {
    // Search window: assignment date can be 0-2 days before stock buy settles
    const searchStart = new Date(buyDate);
    searchStart.setDate(searchStart.getDate() - 2);

    const assignedPut = await prisma.importedTrade.findFirst({
      where: {
        underlying: symbol,
        secType: "OPT",
        right: "P",
        wasAssigned: true,
        assignmentDate: { gte: searchStart, lte: buyDate },
      },
      select: { strike: true, quantity: true, multiplier: true },
    });

    if (!assignedPut?.strike) return null;

    // Verify quantity matches (within 10% tolerance for partial assignments)
    const expectedShares =
      Math.abs(assignedPut.quantity) * (assignedPut.multiplier || 100);
    const actualShares = Math.abs(quantity);
    if (Math.abs(expectedShares - actualShares) / expectedShares > 0.1)
      return null;

    return assignedPut.strike;
  }

  // ============ Option FIFO Helpers ============

  private static readonly STRIKE_TOLERANCE_PERCENT = 0.02;
  private static readonly STRIKE_TOLERANCE_ABS = 1.0;

  /**
   * Find option opens for a symbol, including relaxed matching for corporate actions
   */
  private async findOptionOpens(symbol: string, sampleClose?: { conId: number | null; underlying: string | null; expiry: Date | null; right: string | null; strike: number | null }) {
    let opens = await prisma.importedTrade.findMany({
      where: { symbol, secType: "OPT", openClose: "O" },
      orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
    });

    if (opens.length > 0 || !sampleClose) return opens;

    // Try conId match
    if (sampleClose.conId) {
      opens = await prisma.importedTrade.findMany({
        where: { conId: sampleClose.conId, secType: "OPT", openClose: "O" },
        orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
      });
      if (opens.length > 0) return opens;
    }

    // Try relaxed match by underlying/expiry/right with strike tolerance
    if (sampleClose.underlying && sampleClose.expiry && sampleClose.right) {
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
          if (strikeDiff <= TaxCalculationService.STRIKE_TOLERANCE_ABS ||
              percentDiff <= TaxCalculationService.STRIKE_TOLERANCE_PERCENT) {
            opens.push(candidate);
          }
        }
      }
    }

    return opens;
  }

  /**
   * Build option lot info with exchange rates
   */
  private async buildOptionLots(opens: Array<{ id: string; tradeDate: Date; quantity: number; proceeds: number | null; currency: string | null; buySell: string; wasAssigned?: boolean }>) {
    const lots: Array<{
      id: string;
      lotRef: string;
      tradeDate: Date;
      originalQty: number;
      remainingQty: number;
      premiumPerContract: number;
      totalPremium: number;
      exchangeRate: number;
      currency: string;
      isShort: boolean;
      action: string;
      wasAssigned: boolean;
    }> = [];

    for (let i = 0; i < opens.length; i++) {
      const open = opens[i];
      const qty = Math.abs(open.quantity);
      const rate = await cnbExchangeRateService.getRate(open.tradeDate, open.currency || "USD");
      const totalPremium = Math.abs(open.proceeds || 0);

      lots.push({
        id: open.id,
        lotRef: `lot-${i + 1}`,
        tradeDate: open.tradeDate,
        originalQty: qty,
        remainingQty: qty,
        premiumPerContract: qty > 0 ? totalPremium / qty : 0,
        totalPremium,
        exchangeRate: rate || 0,
        currency: open.currency || "USD",
        isShort: open.buySell === "SELL",
        action: open.buySell === "SELL" ? "SELL to open" : "BUY to open",
        wasAssigned: open.wasAssigned || false,
      });
    }

    return lots;
  }

  /**
   * Determine option close type
   * @param openWasAssigned - wasAssigned flag from the matched OPEN trade (set by detectAssignments)
   */
  private determineCloseType(close: { proceeds: number | null }, openWasAssigned: boolean): "closed" | "expired" | "assigned" {
    if (openWasAssigned) {
      return "assigned";
    }
    if (close.proceeds === 0) {
      return "expired";
    }
    return "closed";
  }

  /**
   * Determine option close action label
   */
  private determineCloseAction(buySell: string, closeType: "closed" | "expired" | "assigned"): string {
    if (closeType === "assigned") return "Assigned";
    if (closeType === "expired") return "Expired";
    return buySell === "BUY" ? "BUY to close" : "SELL to close";
  }

  /**
   * Build option description from trade data
   */
  private buildOptionDescription(trade: { underlying: string | null; symbol: string; strike: number | null; right: string | null; expiry: Date | null }): string {
    const strike = trade.strike || 0;
    const right = trade.right || "";
    const expiry = trade.expiry ? trade.expiry.toISOString().split("T")[0] : "";
    return `${trade.underlying || trade.symbol} ${strike} ${right} ${expiry}`;
  }

  // ============ End Option FIFO Helpers ============

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

    // Get all unique symbols with closes in the year
    const closesInYear = await prisma.importedTrade.findMany({
      where: { secType: "OPT", openClose: "C", tradeDate: { gte: startDate, lte: endDate } },
      select: { symbol: true },
      distinct: ["symbol"],
    });

    const trades: TaxOptionTrade[] = [];
    let totalIncome = 0;
    let totalExpenses = 0;

    for (const { symbol } of closesInYear) {
      // Get sample close for relaxed matching
      const sampleClose = await prisma.importedTrade.findFirst({
        where: { symbol, secType: "OPT", openClose: "C" },
      });

      const opens = await this.findOptionOpens(symbol, sampleClose || undefined);
      const lots = await this.buildOptionLots(opens);

      // Get ALL closes to process FIFO correctly (including pre-year)
      const allCloses = await prisma.importedTrade.findMany({
        where: { symbol, secType: "OPT", openClose: "C" },
        orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
      });

      for (const close of allCloses) {
        const closeQty = Math.abs(close.quantity);
        const closeRate = await cnbExchangeRateService.getRate(close.tradeDate, close.currency || "USD");
        const closePremiumPerContract = closeQty > 0 ? Math.abs(close.proceeds || 0) / closeQty : 0;

        // FIFO matching - determine close type AFTER matching to use the open trade's wasAssigned flag
        let qtyRemaining = closeQty;
        let incomeUsd = 0, expenseUsd = 0, incomeCzk = 0, expenseCzk = 0;
        let hasMatchingOpen = false;
        let openWasAssigned = false;

        // First pass: FIFO matching to find consumed lots and assignment status
        const consumedLotInfo: Array<{ lot: typeof lots[0]; qty: number }> = [];
        for (const lot of lots) {
          if (qtyRemaining <= 0 || lot.remainingQty <= 0 || lot.tradeDate > close.tradeDate) continue;

          hasMatchingOpen = true;
          if (lot.wasAssigned) openWasAssigned = true;
          const qtyToConsume = Math.min(qtyRemaining, lot.remainingQty);
          consumedLotInfo.push({ lot, qty: qtyToConsume });

          lot.remainingQty -= qtyToConsume;
          qtyRemaining -= qtyToConsume;
        }

        // Determine close type using the open trade's assignment status
        const closeType = this.determineCloseType(close, openWasAssigned);

        // Second pass: calculate income/expense using the determined close type
        for (const { lot, qty: qtyToConsume } of consumedLotInfo) {
          const openPremiumUsd = lot.premiumPerContract * qtyToConsume;
          const openPremiumCzk = openPremiumUsd * lot.exchangeRate;
          const closePremiumUsd = closePremiumPerContract * qtyToConsume;
          const closePremiumCzk = closePremiumUsd * (closeRate || 0);

          // Czech tax: Income = money received, Expense = money paid
          if (lot.isShort) {
            incomeUsd += openPremiumUsd;
            incomeCzk += openPremiumCzk;
            if (closeType === "closed") {
              expenseUsd += closePremiumUsd;
              expenseCzk += closePremiumCzk;
            }
          } else {
            expenseUsd += openPremiumUsd;
            expenseCzk += openPremiumCzk;
            if (closeType === "closed") {
              incomeUsd += closePremiumUsd;
              incomeCzk += closePremiumCzk;
            }
          }
        }

        // If no matching open but IBKR provides realizedPnl and costBasis, populate USD values
        // for informational purposes. However, we CANNOT calculate accurate CZK values because
        // Czech tax law requires using the exchange rate from the OPEN date for income, and we
        // don't know when the open trade happened. The trade must remain "missing_open".
        if (!hasMatchingOpen && close.realizedPnl !== null && close.costBasis !== null) {
          // IBKR's costBasis = premium from opening trade
          // IBKR's proceeds = cash flow from closing trade (negative for BUY, positive for SELL)
          // For BUY to close (was short): Income = costBasis (premium received), Expense = |proceeds|
          // For SELL to close (was long): Income = proceeds (received), Expense = costBasis (paid)
          const isClosingShort = close.buySell === "BUY";
          if (isClosingShort) {
            incomeUsd = close.costBasis;
            expenseUsd = Math.abs(close.proceeds || 0);
          } else {
            incomeUsd = Math.abs(close.proceeds || 0);
            expenseUsd = close.costBasis;
          }
          // CZK values stay at 0 - we can't calculate them without the open date's exchange rate
        }

        // Only add to results if this close is in the target year
        if (close.tradeDate >= startDate && close.tradeDate <= endDate) {
          const trade: TaxOptionTrade = {
            id: close.id,
            symbol: close.symbol,
            description: this.buildOptionDescription(close),
            quantity: closeQty,
            closeType,
            dateClosed: close.tradeDate.toISOString().split("T")[0],
            proceedsUsd: incomeUsd,
            costBasisUsd: expenseUsd,
            pnlUsd: incomeUsd - expenseUsd,
            rate: closeRate || 0,
            proceedsCzk: incomeCzk,
            costBasisCzk: expenseCzk,
            pnlCzk: incomeCzk - expenseCzk,
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

    trades.sort((a, b) => a.dateClosed.localeCompare(b.dateClosed));
    return { trades, totals: { income: totalIncome, expenses: totalExpenses, profit: totalIncome - totalExpenses } };
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
   * Corporate actions (splits, ticker changes) are shown as separate entries
   */
  async getLotTrace(symbol: string): Promise<LotTraceResponse> {
    const THREE_YEARS_DAYS = 3 * 365;

    // Get all sells for this symbol
    const sells = await prisma.importedTrade.findMany({
      where: {
        symbol,
        secType: "STK",
        buySell: "SELL",
      },
      orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
    });

    // Get all buys for this symbol
    let buys = await prisma.importedTrade.findMany({
      where: {
        symbol,
        secType: "STK",
        buySell: "BUY",
      },
      orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
    });

    // If no buys found by symbol, try conId fallback (handles ticker changes like ZOK -> QZEU)
    if (buys.length === 0 && sells.length > 0) {
      const sampleSell = sells[0];
      if (sampleSell.conId) {
        buys = await prisma.importedTrade.findMany({
          where: {
            conId: sampleSell.conId,
            secType: "STK",
            buySell: "BUY",
          },
          orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
        });
      }
    }

    // Get corporate actions for this symbol (splits, stock dividends, ticker changes)
    const corporateActions = await prisma.corporateAction.findMany({
      where: {
        symbol,
        actionType: { in: ["FS", "RS", "SD", "TC"] },
      },
      orderBy: { exDate: "asc" },
    });

    // Build lot tracking structure (with original quantities, splits applied dynamically)
    interface LotInfo {
      id: string;
      lotRef: string;
      tradeDate: Date;
      originalQty: number; // Current quantity (updated by splits for FIFO tracking)
      remainingQty: number; // Current remaining (updated by splits and sells)
      pricePerShare: number; // Current price per share (updated by splits)
      commission: number;
      exchangeRate: number;
      currency: string;
      costBasisUsd: number; // Never changes
      costBasisCzk: number; // Never changes
      splitMultiplier: number; // Cumulative split ratio (e.g., 10 for 10:1 split)
    }

    const lots: LotInfo[] = [];
    const entries: LotTraceEntry[] = [];

    // Pre-fetch exchange rates for buys
    const buyRates = new Map<string, number>();
    for (const buy of buys) {
      const rate = await cnbExchangeRateService.getRate(
        buy.tradeDate,
        buy.currency || "USD"
      );
      buyRates.set(buy.id, rate || 0);
    }

    // Combine buys, sells, and corporate actions into chronological order
    interface TradeEvent {
      type: "buy" | "sell" | "corporate_action";
      date: Date;
      buy?: (typeof buys)[0];
      sell?: (typeof sells)[0];
      corporateAction?: (typeof corporateActions)[0];
    }

    const events: TradeEvent[] = [
      ...buys.map((buy) => ({
        type: "buy" as const,
        date: buy.tradeDate,
        buy,
      })),
      ...sells.map((sell) => ({
        type: "sell" as const,
        date: sell.tradeDate,
        sell,
      })),
      ...corporateActions.map((ca) => ({
        type: "corporate_action" as const,
        date: ca.exDate,
        corporateAction: ca,
      })),
    ];

    // Sort by date, then: buys -> corporate actions -> sells
    events.sort((a, b) => {
      const dateDiff = a.date.getTime() - b.date.getTime();
      if (dateDiff !== 0) return dateDiff;
      const typeOrder = { buy: 0, corporate_action: 1, sell: 2 };
      return typeOrder[a.type] - typeOrder[b.type];
    });

    // Process events chronologically
    let lotIndex = 0;
    for (const event of events) {
      if (event.type === "buy" && event.buy) {
        const buy = event.buy;
        const qty = Math.abs(buy.quantity);
        const rate = buyRates.get(buy.id) || 0;

        // Check if this BUY came from a PUT assignment
        const assignedStrike = await this.findAssignedPutStrike(
          symbol,
          buy.tradeDate,
          buy.quantity
        );

        let costBasisUsd: number;
        if (assignedStrike !== null) {
          // Assigned stock: use Strike × Quantity (actual cash paid)
          costBasisUsd = assignedStrike * qty - buy.commission;
        } else {
          // Normal purchase: use IBKR proceeds + commission
          costBasisUsd = Math.abs(buy.proceeds || 0) - buy.commission;
        }
        const costBasisCzk = costBasisUsd * rate;

        const lotInfo: LotInfo = {
          id: buy.id,
          lotRef: `lot-${++lotIndex}`,
          tradeDate: buy.tradeDate,
          originalQty: qty,
          remainingQty: qty,
          pricePerShare: assignedStrike !== null ? assignedStrike : buy.tradePrice,
          commission: buy.commission,
          exchangeRate: rate,
          currency: buy.currency || "USD",
          costBasisUsd,
          costBasisCzk,
          splitMultiplier: 1,
        };

        lots.push(lotInfo);

        entries.push({
          type: "buy",
          id: lotInfo.id,
          lotRef: lotInfo.lotRef,
          tradeDate: lotInfo.tradeDate.toISOString().split("T")[0],
          quantity: lotInfo.originalQty,
          pricePerShare: lotInfo.pricePerShare,
          exchangeRate: lotInfo.exchangeRate,
          currency: lotInfo.currency,
          costBasisUsd: lotInfo.costBasisUsd,
          costBasisCzk: lotInfo.costBasisCzk,
          remainingQty: lotInfo.remainingQty,
        });

      } else if (event.type === "corporate_action" && event.corporateAction) {
        const ca = event.corporateAction;
        const splitRatio = ca.splitRatio || 1;

        // Only process splits (FS, RS, SD) that have a ratio
        if ((ca.actionType === "FS" || ca.actionType === "RS" || ca.actionType === "SD") && splitRatio !== 1) {
          // Find lots that existed before this split and have remaining shares
          const affectedLots: { lotRef: string; quantityBefore: number; quantityAfter: number }[] = [];

          for (const lot of lots) {
            if (lot.tradeDate < ca.exDate && lot.remainingQty > 0) {
              const qtyBefore = lot.originalQty;

              // Apply split to this lot (for FIFO tracking)
              lot.originalQty *= splitRatio;
              lot.remainingQty *= splitRatio;
              lot.pricePerShare /= splitRatio;
              lot.splitMultiplier *= splitRatio;

              affectedLots.push({
                lotRef: lot.lotRef,
                quantityBefore: qtyBefore,
                quantityAfter: lot.originalQty,
              });

              // Note: Buy entry is NOT updated - it stays in original terms
              // The split is shown as a separate corporate action entry
            }
          }

          // Only add entry if there were affected lots
          if (affectedLots.length > 0) {
            const totalQtyBefore = affectedLots.reduce((sum, l) => sum + l.quantityBefore, 0);
            const totalQtyAfter = affectedLots.reduce((sum, l) => sum + l.quantityAfter, 0);

            entries.push({
              type: "corporate_action",
              id: ca.id,
              lotRef: "",
              tradeDate: ca.exDate.toISOString().split("T")[0],
              quantity: totalQtyAfter - totalQtyBefore, // Net shares added
              pricePerShare: 0,
              exchangeRate: 0,
              currency: "USD",
              actionType: ca.actionType,
              actionDescription: ca.description || `${splitRatio}:1 split`,
              splitRatio,
              affectedLots,
            });
          }
        } else if (ca.actionType === "TC") {
          // Ticker change - just show informational entry
          entries.push({
            type: "corporate_action",
            id: ca.id,
            lotRef: "",
            tradeDate: ca.exDate.toISOString().split("T")[0],
            quantity: 0,
            pricePerShare: 0,
            exchangeRate: 0,
            currency: "USD",
            actionType: ca.actionType,
            actionDescription: ca.description || "Ticker change",
          });
        }

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

          // Calculate proportional cost basis from the lot's total cost
          const proportionOfLot = qtyToConsume / lot.originalQty;
          const lotCostUsd = lot.costBasisUsd * proportionOfLot;
          const lotCostCzk = lot.costBasisCzk * proportionOfLot;

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
          lotRef: "",
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

    // Update remainingQty on buy entries to reflect final state (in original terms)
    for (const entry of entries) {
      if (entry.type === "buy") {
        const lot = lots.find((l) => l.lotRef === entry.lotRef);
        if (lot) {
          // Convert remaining quantity back to original terms (before splits)
          entry.remainingQty = lot.remainingQty / lot.splitMultiplier;
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
    // Get closes for this option symbol
    const closes = await prisma.importedTrade.findMany({
      where: { symbol, secType: "OPT", openClose: "C" },
      orderBy: [{ tradeDate: "asc" }, { id: "asc" }],
    });

    // Find opens using helper (includes relaxed matching for corporate actions)
    const sampleClose = closes[0];
    const opens = await this.findOptionOpens(symbol, sampleClose || undefined);

    // Build lots using helper
    const lots = await this.buildOptionLots(opens);

    // Build description from first trade
    const sampleTrade = opens[0] || closes[0];
    const description = sampleTrade ? this.buildOptionDescription(sampleTrade) : symbol;

    const entries: OptionLotTraceEntry[] = [];

    // Combine opens and closes into chronological order for processing
    type TradeEvent =
      | { type: "open"; date: Date; openIndex: number }
      | { type: "close"; date: Date; close: (typeof closes)[0] };

    const events: TradeEvent[] = [
      ...opens.map((open, i) => ({ type: "open" as const, date: open.tradeDate, openIndex: i })),
      ...closes.map((close) => ({ type: "close" as const, date: close.tradeDate, close })),
    ];

    // Sort by date, then opens before closes on same date
    events.sort((a, b) => {
      const dateDiff = a.date.getTime() - b.date.getTime();
      if (dateDiff !== 0) return dateDiff;
      return a.type === "open" && b.type === "close" ? -1 : a.type === "close" && b.type === "open" ? 1 : 0;
    });

    // Process events chronologically
    for (const event of events) {
      if (event.type === "open") {
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
      } else {
        const close = event.close;
        const closeQty = Math.abs(close.quantity);
        let qtyRemaining = closeQty;

        const closeRate = await cnbExchangeRateService.getRate(close.tradeDate, close.currency || "USD");
        const closeProceeds = close.proceeds || 0;
        const closePremiumPerContract = closeQty > 0 ? closeProceeds / closeQty : 0;

        const consumedLots: OptionConsumedLot[] = [];
        let openWasAssigned = false;

        // Consume from oldest lots (FIFO)
        for (const lot of lots) {
          if (qtyRemaining <= 0 || lot.remainingQty <= 0) continue;

          if (lot.wasAssigned) openWasAssigned = true;
          const qtyToConsume = Math.min(qtyRemaining, lot.remainingQty);

          // Calculate proportional premiums
          const proportionOfLot = qtyToConsume / lot.originalQty;
          const openPremiumUsd = Math.abs(lot.totalPremium) * proportionOfLot;
          const openPremiumCzk = openPremiumUsd * lot.exchangeRate;

          const proportionOfClose = qtyToConsume / closeQty;
          const closePremiumUsd = Math.abs(closeProceeds) * proportionOfClose;
          const closePremiumCzk = closePremiumUsd * (closeRate || 0);

          // P&L: short positions = received - paid, long positions = received - paid
          const isShort = lot.isShort;
          const pnlUsd = isShort ? openPremiumUsd - closePremiumUsd : closePremiumUsd - openPremiumUsd;
          const pnlCzk = isShort ? openPremiumCzk - closePremiumCzk : closePremiumCzk - openPremiumCzk;

          const holdingDays = Math.floor((close.tradeDate.getTime() - lot.tradeDate.getTime()) / (1000 * 60 * 60 * 24));

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

        // Determine close type using the open trade's assignment status
        const closeType = this.determineCloseType(close, openWasAssigned);
        const closeAction = this.determineCloseAction(close.buySell, closeType);

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
        if (lot) entry.remainingQty = lot.remainingQty;
      }
    }

    const currentPosition = lots.reduce((sum, lot) => sum + lot.remainingQty, 0);

    return { symbol, description, entries, currentPosition };
  }
}

export const taxCalculationService = new TaxCalculationService();
