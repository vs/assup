import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@assup/shared";
import type { PositionSummary, DashboardSummary } from "@assup/shared";
import { Card, CardContent } from "@/components/ui/card";
import { dashboardApi } from "@/api/dashboard";
import { Landmark, ShieldAlert, ShieldCheck, TrendingUpDown, CalendarClock, Clock, Timer } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  valueClassName?: string;
}

function MetricCard({ label, value, detail, icon: Icon, valueClassName }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between mb-2">
          <div className="text-xs text-muted-foreground font-medium">{label}</div>
          <Icon className="h-4 w-4 text-muted-foreground/60" />
        </div>
        <div className={`text-xl font-semibold tabular-nums ${valueClassName ?? ""}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{detail}</div>
      </CardContent>
    </Card>
  );
}

interface MetricsRowProps {
  positionSummary: PositionSummary | undefined;
  dashboardData: DashboardSummary | undefined;
}

export function MetricsRow({ positionSummary, dashboardData }: MetricsRowProps) {
  const nlv = positionSummary?.account.netLiquidation ?? 0;
  const cash = positionSummary?.account.cashValue ?? 0;
  const stockValue = positionSummary?.summary.totalStockValue ?? 0;
  const putNotional = positionSummary?.summary.totalPutNotional ?? 0;
  const callNotional = positionSummary?.summary.totalCallNotional ?? 0;
  const putDelta = positionSummary?.summary.totalPutDelta ?? 0;
  const callDelta = positionSummary?.summary.totalCallDelta ?? 0;
  const totalTheta = positionSummary?.summary.totalTheta ?? 0;

  // Total unrealized P&L across all positions
  const totalUnrealized = positionSummary?.positions.reduce(
    (sum, p) => sum + (p.unrealizedPnl ?? 0), 0
  ) ?? 0;
  const totalCostBasis = positionSummary?.positions.reduce(
    (sum, p) => sum + p.costBasis, 0
  ) ?? 0;
  const pnlPct = totalCostBasis !== 0 ? (totalUnrealized / totalCostBasis) * 100 : 0;

  // Current month pace
  const pace = dashboardData?.currentMonthPace;

  // Today's P&L from IBKR real-time subscription
  const { data: dailyPnl } = useQuery({
    queryKey: ["dashboard", "daily-pnl"],
    queryFn: () => dashboardApi.dailyPnl(),
    refetchInterval: 30_000,
  });

  const todayTotal = dailyPnl?.dailyPnL ?? 0;
  const todayRealized = dailyPnl?.realizedPnL ?? 0;

  return (
    <div className="grid grid-cols-7 gap-3">
      <MetricCard
        label="Net Liquidation"
        icon={Landmark}
        value={formatCurrency(nlv)}
        detail={`Cash ${formatCurrency(cash)} · Stocks ${formatCurrency(stockValue)}`}
      />
      <MetricCard
        label="Puts Exposure"
        icon={ShieldAlert}
        value={formatCurrency(putNotional)}
        detail={`Delta ${formatCurrency(putDelta)}`}
      />
      <MetricCard
        label="Calls Exposure"
        icon={ShieldCheck}
        value={formatCurrency(callNotional)}
        detail={`Delta ${formatCurrency(callDelta)}`}
      />
      <MetricCard
        label="Daily Theta"
        icon={Timer}
        value={formatCurrency(totalTheta)}
        detail={`${formatCurrency(totalTheta * 30)}/mo projected`}
        valueClassName={totalTheta >= 0 ? "text-green-600" : "text-red-600"}
      />
      <MetricCard
        label="Unrealized P&L"
        icon={TrendingUpDown}
        value={formatCurrency(totalUnrealized)}
        detail={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% of cost basis`}
        valueClassName={totalUnrealized >= 0 ? "text-green-600" : "text-red-600"}
      />
      <MetricCard
        label="Current Month"
        icon={CalendarClock}
        value={pace ? formatCurrency(pace.estimatedTotal) : "—"}
        detail={pace ? `Realized ${formatCurrency(pace.realized)} · Projected ${formatCurrency(pace.projected)}` : ""}
        valueClassName={pace && pace.estimatedTotal >= 0 ? "text-green-600" : "text-red-600"}
      />
      <MetricCard
        label="Today's P&L"
        icon={Clock}
        value={formatCurrency(todayTotal)}
        detail={`Realized ${formatCurrency(todayRealized)} · ${nlv > 0 ? `${(todayTotal / nlv * 100).toFixed(2)}% of portfolio` : ""}`}
        valueClassName={todayTotal >= 0 ? "text-green-600" : "text-red-600"}
      />
    </div>
  );
}
