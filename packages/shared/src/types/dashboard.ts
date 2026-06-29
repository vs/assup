export type DashboardPeriod = "mtd" | "ytd" | "year" | "all";

export interface ChartDataPoint {
  period: string; // "2026-01" for monthly, "2026-01-15" for daily
  options: number;
  spreads: number;
  stocks: number;
  dividendsInterest: number;
  fees: number;
  total: number;
  cumulative: number;
  projected?: number; // projected profit for current month (options expiring worthless)
}

export interface StrategyMetrics {
  total: number;
  tradeCount: number;
  sparkline: number[];
}

export interface DashboardSummary {
  currentMonthPace: {
    realized: number;
    projected: number;
    estimatedTotal: number;
    daysRemaining: number;
  };
  periodTotal: {
    total: number;
    realized: number;
    unrealized: number | null;
    projected: number | null;
  };
  periodIncludesCurrentMonth: boolean;
  chart: ChartDataPoint[];
  strategies: {
    options: StrategyMetrics;
    spreads: StrategyMetrics;
    stocks: StrategyMetrics;
    dividendsInterest: StrategyMetrics;
    fees: StrategyMetrics;
  };
}
