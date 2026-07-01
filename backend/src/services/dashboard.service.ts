import { DashboardSummary, DashboardPeriod, ChartDataPoint, MonthDetail } from "@assup/shared";
import { profitService } from "./profit.service.js";

export class DashboardService {
  private profitService = profitService;

  async getSummary(period: DashboardPeriod, year?: number): Promise<DashboardSummary> {
    const now = new Date();
    const { startDate, endDate, includesCurrentMonth } = this.getDateRange(period, year);

    // getMonthlyProfits() already includes TWS data for the current month,
    // so monthlyData.months and monthlyData.totals are TWS-inclusive.
    const [monthlyData, projectedByMonth] = await Promise.all([
      this.profitService.getMonthlyProfits(startDate, endDate),
      this.profitService.getProjectedByMonth(),
    ]);

    // For MTD, we need full trade-level detail for the daily chart.
    // For unrealized/projected we need current positions from IBKR.
    let chart: ChartDataPoint[];
    let strategies: DashboardSummary["strategies"];

    if (period === "mtd") {
      const currentMonthDetail = await this.profitService.getMonthDetail(now.getFullYear(), now.getMonth() + 1);
      chart = this.buildDailyChartData(currentMonthDetail);
      strategies = this.buildStrategiesFromDetail(currentMonthDetail);
    } else {
      chart = this.buildChartData(monthlyData.months);
      strategies = this.buildStrategies(monthlyData.months);
    }

    // Totals already include TWS data for the current month
    const realized = monthlyData.totals.total;

    // Current month realized from the already TWS-inclusive monthly data
    const currentMonthEntry = monthlyData.months.find(
      (m) => m.year === now.getFullYear() && m.month === now.getMonth() + 1,
    );
    let currentMonthRealized = currentMonthEntry?.total ?? 0;
    let currentMonthProjected = 0;

    // Get unrealized/projected from IBKR positions
    let unrealized: number | null = null;
    // Sum projected across ALL months (current + future), not just current month
    let projected: number | null = null;

    if (includesCurrentMonth) {
      const currentMonth = await this.profitService.getCurrentMonthProfit();
      unrealized = currentMonth.unrealized.value;
      currentMonthProjected = currentMonth.projected.value;

      let totalProjected = 0;
      for (const [, value] of projectedByMonth) {
        totalProjected += value;
      }
      projected = totalProjected > 0 ? totalProjected : null;
    }

    const total = realized + (unrealized ?? 0) + (projected ?? 0);

    // Attach projected values to chart data points for all months with
    // open short options (current month + future months).
    if (period !== "mtd" && projectedByMonth.size > 0) {
      const existingPeriods = new Set(chart.map((p) => p.period));
      for (const [monthPeriod, projValue] of projectedByMonth) {
        if (projValue <= 0) continue;
        const existing = chart.find((p) => p.period === monthPeriod);
        if (existing) {
          existing.projected = projValue;
        } else {
          // Future month not yet in chart — add a placeholder point
          const prev = chart[chart.length - 1];
          chart.push({
            period: monthPeriod,
            options: 0,
            spreads: 0,
            stocks: 0,
            dividendsInterest: 0,
            fees: 0,
            total: 0,
            cumulative: prev?.cumulative ?? 0,
            projected: projValue,
          });
        }
      }
      // Re-sort if we added future months
      chart.sort((a, b) => a.period.localeCompare(b.period));
    }

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysRemaining = daysInMonth - now.getDate();

    return {
      currentMonthPace: {
        realized: currentMonthRealized,
        projected: currentMonthProjected,
        estimatedTotal: currentMonthRealized + currentMonthProjected,
        daysRemaining,
      },
      periodTotal: {
        total,
        realized,
        unrealized,
        projected,
      },
      periodIncludesCurrentMonth: includesCurrentMonth,
      chart,
      strategies,
    };
  }

  private getDateRange(period: DashboardPeriod, year?: number): {
    startDate?: Date;
    endDate?: Date;
    includesCurrentMonth: boolean;
  } {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed

    switch (period) {
      case "mtd": {
        const start = new Date(currentYear, currentMonth, 1);
        return {
          startDate: start,
          endDate: now,
          includesCurrentMonth: true,
        };
      }
      case "ytd": {
        const start = new Date(currentYear, 0, 1);
        return {
          startDate: start,
          endDate: now,
          includesCurrentMonth: true,
        };
      }
      case "year": {
        const selectedYear = year ?? currentYear;
        const start = new Date(selectedYear, 0, 1);
        const end = new Date(selectedYear, 11, 31);
        return {
          startDate: start,
          endDate: end,
          includesCurrentMonth: selectedYear === currentYear,
        };
      }
      case "all":
        return {
          includesCurrentMonth: true,
        };
    }
  }

  private buildChartData(months: Array<{
    year: number;
    month: number;
    optionsProfit: number;
    spreadsProfit: number;
    stocksProfit: number;
    dividends: number;
    interest: number;
    withholdingTax: number;
    fees: number;
    total: number;
  }>): ChartDataPoint[] {
    // Sort ascending for cumulative calculation
    const sorted = [...months].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

    let cumulative = 0;
    return sorted.map((m) => {
      const dividendsInterest = m.dividends + m.interest + m.withholdingTax;
      cumulative += m.total;
      return {
        period: `${m.year}-${String(m.month).padStart(2, "0")}`,
        options: m.optionsProfit,
        spreads: m.spreadsProfit,
        stocks: m.stocksProfit,
        dividendsInterest,
        fees: m.fees,
        total: m.total,
        cumulative,
      };
    });
  }

  private buildStrategies(months: Array<{
    year: number;
    month: number;
    optionsProfit: number;
    spreadsProfit: number;
    stocksProfit: number;
    dividends: number;
    interest: number;
    withholdingTax: number;
    fees: number;
    tradeCount: number;
    spreadTradeCount: number;
    stockTradeCount: number;
    cashTransactionCount: number;
  }>): DashboardSummary["strategies"] {
    // Sort ascending for sparkline
    const sorted = [...months].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

    const sumField = (field: (m: typeof sorted[0]) => number) =>
      sorted.reduce((sum, m) => sum + field(m), 0);

    return {
      options: {
        total: sumField((m) => m.optionsProfit),
        tradeCount: sumField((m) => m.tradeCount),
        sparkline: sorted.map((m) => m.optionsProfit),
      },
      spreads: {
        total: sumField((m) => m.spreadsProfit),
        tradeCount: sumField((m) => m.spreadTradeCount),
        sparkline: sorted.map((m) => m.spreadsProfit),
      },
      stocks: {
        total: sumField((m) => m.stocksProfit),
        tradeCount: sumField((m) => m.stockTradeCount),
        sparkline: sorted.map((m) => m.stocksProfit),
      },
      dividendsInterest: {
        total: sumField((m) => m.dividends + m.interest + m.withholdingTax),
        tradeCount: sumField((m) => m.cashTransactionCount),
        sparkline: sorted.map((m) => m.dividends + m.interest + m.withholdingTax),
      },
      fees: {
        total: sumField((m) => m.fees),
        tradeCount: sumField((m) => m.tradeCount + m.spreadTradeCount + m.stockTradeCount),
        sparkline: sorted.map((m) => m.fees),
      },
    };
  }

  private buildDailyChartData(monthDetail: MonthDetail): ChartDataPoint[] {
    // MonthDetail.realized has separate arrays: spreadTrades, optionTrades,
    // stockTrades, dividends, interest, withholdingTax, fees
    const dailyMap = new Map<string, ChartDataPoint>();

    const getOrCreate = (dateStr: string): ChartDataPoint => {
      if (!dailyMap.has(dateStr)) {
        dailyMap.set(dateStr, {
          period: dateStr,
          options: 0, spreads: 0, stocks: 0, dividendsInterest: 0, fees: 0, total: 0, cumulative: 0,
        });
      }
      return dailyMap.get(dateStr)!;
    };

    // Spread trades by close date
    for (const spread of monthDetail.realized.spreadTrades) {
      const day = getOrCreate(spread.closeDate ?? spread.openDate);
      day.spreads += spread.profit;
      day.total += spread.profit;
    }

    // Option trades by close/expiry date (expired worthless trades have no closeTrade)
    for (const trade of monthDetail.realized.optionTrades) {
      const dateKey = trade.closeTrade?.tradeDate ?? trade.expiry ?? trade.openTrade?.tradeDate;
      if (dateKey) {
        const day = getOrCreate(dateKey);
        day.options += trade.profit;
        day.total += trade.profit;
      }
    }

    // Stock trades by sell date
    for (const trade of monthDetail.realized.stockTrades) {
      const dateKey = trade.sellTrade?.tradeDate;
      if (dateKey) {
        const day = getOrCreate(dateKey);
        day.stocks += trade.profit;
        day.total += trade.profit;
      }
    }

    // Dividends, interest, withholding tax → dividendsInterest bucket
    for (const tx of monthDetail.realized.dividends) {
      const day = getOrCreate(tx.transactionDate);
      day.dividendsInterest += tx.amount;
      day.total += tx.amount;
    }
    for (const tx of monthDetail.realized.interest) {
      const day = getOrCreate(tx.transactionDate);
      day.dividendsInterest += tx.amount;
      day.total += tx.amount;
    }
    for (const tx of monthDetail.realized.withholdingTax) {
      const day = getOrCreate(tx.transactionDate);
      day.dividendsInterest += tx.amount;
      day.total += tx.amount;
    }

    // Fees → fees bucket
    for (const tx of monthDetail.realized.fees) {
      const day = getOrCreate(tx.transactionDate);
      day.fees += tx.amount;
      day.total += tx.amount;
    }

    // Sort by date and compute cumulative
    const sorted = [...dailyMap.values()].sort((a, b) => a.period.localeCompare(b.period));
    let cumulative = 0;
    for (const point of sorted) {
      cumulative += point.total;
      point.cumulative = cumulative;
    }
    return sorted;
  }

  private buildStrategiesFromDetail(monthDetail: MonthDetail): DashboardSummary["strategies"] {
    const { spreadTrades, optionTrades, stockTrades, dividends, interest, withholdingTax, fees } = monthDetail.realized;

    const spreadTotal = spreadTrades.reduce((s, t) => s + t.profit, 0);
    const optionTotal = optionTrades.reduce((s, t) => s + t.profit, 0);
    const stockTotal = stockTrades.reduce((s, t) => s + t.profit, 0);
    const divIntTotal = [...dividends, ...interest, ...withholdingTax].reduce((s, t) => s + t.amount, 0);
    const feesTotal = fees.reduce((s, t) => s + t.amount, 0);
    const divIntCount = dividends.length + interest.length + withholdingTax.length;

    return {
      options: { total: optionTotal, tradeCount: optionTrades.length, sparkline: [optionTotal] },
      spreads: { total: spreadTotal, tradeCount: spreadTrades.length, sparkline: [spreadTotal] },
      stocks: { total: stockTotal, tradeCount: stockTrades.length, sparkline: [stockTotal] },
      dividendsInterest: { total: divIntTotal, tradeCount: divIntCount, sparkline: [divIntTotal] },
      fees: { total: feesTotal, tradeCount: fees.length, sparkline: [feesTotal] },
    };
  }
}
