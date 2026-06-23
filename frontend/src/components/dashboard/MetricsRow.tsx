import { formatCurrency } from "@assup/shared";
import type { PositionSummary } from "@assup/shared";
import type { ActiveSpread } from "@assup/shared";
import type { WheelListResponse } from "@assup/shared";
import type { AllPositionsView } from "@assup/shared";
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
  spreads: ActiveSpread[] | undefined;
  wheelData: WheelListResponse | undefined;
  profitPositions: AllPositionsView | undefined;
}

export function MetricsRow({ positionSummary, spreads, wheelData, profitPositions }: MetricsRowProps) {
  const nlv = positionSummary?.account.netLiquidation ?? 0;
  const cash = positionSummary?.account.cashValue ?? 0;
  const stockValue = positionSummary?.summary.totalStockValue ?? 0;
  const putNotional = positionSummary?.summary.totalPutNotional ?? 0;
  const callNotional = positionSummary?.summary.totalCallNotional ?? 0;
  const putDelta = positionSummary?.summary.totalPutDelta ?? 0;
  const callDelta = positionSummary?.summary.totalCallDelta ?? 0;

  const spreadCount = spreads?.length ?? 0;
  const spreadPnl = spreads?.reduce((sum, s) => sum + (s.totalPnl ?? 0), 0) ?? 0;

  const activeWheels = wheelData?.metrics.activeWheels ?? 0;
  const capitalDeployed = wheelData?.metrics.capitalDeployed ?? 0;

  const openOptionsCount = profitPositions?.positions.length ?? 0;
  const totalProjected = profitPositions?.totalProjected ?? 0;

  return (
    <div className="grid grid-cols-6 gap-3">
      <MetricCard
        label="Net Liquidation"
        value={formatCurrency(nlv)}
        detail={`Cash ${formatCurrency(cash)} · Stocks ${formatCurrency(stockValue)}`}
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
      <MetricCard
        label="Active Spreads"
        value={String(spreadCount)}
        detail={`P&L ${formatCurrency(spreadPnl)}`}
        valueClassName={spreadPnl >= 0 ? "text-green-600" : "text-red-600"}
      />
      <MetricCard
        label="Active Wheels"
        value={String(activeWheels)}
        detail={`Capital ${formatCurrency(capitalDeployed)}`}
        valueClassName="text-purple-600"
      />
      <MetricCard
        label="Open Options"
        value={String(openOptionsCount)}
        detail={`Projected ${formatCurrency(totalProjected)}`}
        valueClassName="text-blue-600"
      />
    </div>
  );
}
