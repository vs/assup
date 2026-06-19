import { StrategyMetrics, formatCurrency } from "@assup/shared";
import { PnlSparkline } from "./PnlSparkline";

interface StrategyRowProps {
  name: string;
  color: string;
  metrics: StrategyMetrics;
}

export function StrategyRow({ name, color, metrics }: StrategyRowProps) {
  const { total, tradeCount, sparkline } = metrics;
  const pnlColor = total >= 0 ? "text-green-500" : "text-red-500";

  return (
    <div className="flex items-center gap-3 bg-card border rounded-md px-3 py-2">
      <div className="w-1 h-7 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-medium text-sm w-28">{name}</span>
      <div className="flex-1">
        <PnlSparkline data={sparkline} />
      </div>
      <span className={`font-semibold text-sm tabular-nums w-24 text-right ${pnlColor}`}>
        {formatCurrency(total)}
      </span>
      <span className="text-xs text-muted-foreground w-16 text-right tabular-nums">
        {tradeCount} trades
      </span>
    </div>
  );
}
