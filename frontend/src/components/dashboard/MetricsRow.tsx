import { formatCurrency } from "@assup/shared";
import type { PositionSummary, DashboardSummary } from "@assup/shared";
import { Card, CardContent } from "@/components/ui/card";

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  valueClassName?: string;
}

function MetricCard({ label, value, detail, valueClassName }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="text-xs text-muted-foreground font-medium mb-1">{label}</div>
        <div className={`text-xl font-semibold tabular-nums ${valueClassName ?? ""}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{detail}</div>
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

  // Total P&L across all positions
  const totalUnrealized = positionSummary?.positions.reduce(
    (sum, p) => sum + (p.unrealizedPnl ?? 0), 0
  ) ?? 0;
  const totalCostBasis = positionSummary?.positions.reduce(
    (sum, p) => sum + p.costBasis, 0
  ) ?? 0;
  const pnlPct = totalCostBasis !== 0 ? (totalUnrealized / totalCostBasis) * 100 : 0;

  // Current month pace
  const pace = dashboardData?.currentMonthPace;

  // Today's P&L — realized from dashboard (MTD has daily granularity), unrealized from positions
  const todayRealized = dashboardData?.periodTotal.realized ?? 0;
  const todayUnrealized = totalUnrealized;

  return (
    <div className="grid grid-cols-6 gap-3">
      <MetricCard
        label="Net Liquidation"
        value={formatCurrency(nlv)}
        detail={`Cash ${formatCurrency(cash)} · Stocks ${formatCurrency(stockValue)}`}
      />
      <MetricCard
        label="Total P&L"
        value={formatCurrency(totalUnrealized)}
        detail={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% of cost basis`}
        valueClassName={totalUnrealized >= 0 ? "text-green-600" : "text-red-600"}
      />
      <MetricCard
        label="Current Month"
        value={pace ? formatCurrency(pace.estimatedTotal) : "—"}
        detail={pace ? `Realized ${formatCurrency(pace.realized)} · Projected ${formatCurrency(pace.projected)}` : ""}
        valueClassName={pace && pace.estimatedTotal >= 0 ? "text-green-600" : "text-red-600"}
      />
      <MetricCard
        label="Today's P&L"
        value={formatCurrency(todayRealized + todayUnrealized)}
        detail={`Realized ${formatCurrency(todayRealized)} · Unrealized ${formatCurrency(todayUnrealized)}`}
        valueClassName={(todayRealized + todayUnrealized) >= 0 ? "text-green-600" : "text-red-600"}
      />
      <MetricCard
        label="Puts Exposure"
        value={formatCurrency(putNotional)}
        detail={`Delta ${formatCurrency(putDelta)}`}
        valueClassName="text-red-600"
      />
      <MetricCard
        label="Calls Exposure"
        value={formatCurrency(callNotional)}
        detail={`Delta ${formatCurrency(callDelta)}`}
        valueClassName="text-green-600"
      />
    </div>
  );
}
