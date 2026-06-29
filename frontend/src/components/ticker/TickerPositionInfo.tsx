/**
 * Shows the user's position and wheel strategy info for a ticker.
 * Uses shared cached lookup — renders nothing if no position exists.
 */

import { formatCurrency } from "@assup/shared";
import { usePositionLookup } from "@/hooks/usePositionLookup";
import { Badge } from "@/components/ui/badge";

interface TickerPositionInfoProps {
  symbol: string;
}

const PHASE_LABELS: Record<string, string> = {
  csp_open: "CSP Open",
  holding_shares: "Holding Shares",
  cc_open: "CC Open",
  idle: "Idle",
};

export function TickerPositionInfo({ symbol }: TickerPositionInfoProps) {
  const { position: pos, wheel } = usePositionLookup(symbol);

  const hasPosition = pos && pos.position !== 0;
  const hasWheel = wheel != null;

  if (!hasPosition && !hasWheel) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border rounded-lg px-4 py-2 bg-muted/20 text-sm">
      {/* Stock position info */}
      {hasPosition && (
        <>
          <Stat label="Shares" value={`${pos.position}`} />
          <Stat label="Avg Cost" value={formatCurrency(pos.avgCost, { maximumFractionDigits: 2 })} />
          <Stat label="Cost Basis" value={formatCurrency(pos.costBasis, { maximumFractionDigits: 0 })} />
          {pos.marketValue != null && (
            <Stat label="Mkt Value" value={formatCurrency(pos.marketValue, { maximumFractionDigits: 0 })} />
          )}
          {pos.unrealizedPnl != null && (
            <Stat
              label="Unrealized"
              value={formatCurrency(pos.unrealizedPnl, { maximumFractionDigits: 0 })}
              className={pos.unrealizedPnl >= 0 ? "text-green-600" : "text-red-600"}
            />
          )}
        </>
      )}

      {/* Wheel strategy info */}
      {hasWheel && (
        <>
          <div className="h-4 border-l mx-1" />
          <Badge variant="outline" className="text-xs font-normal">
            Wheel: {wheel.activePhases.map((p) => PHASE_LABELS[p] ?? p).join(" + ") || PHASE_LABELS[wheel.currentPhase]}
          </Badge>
          <Stat
            label="Wheel Basis"
            value={formatCurrency(wheel.adjustedCostBasis, { maximumFractionDigits: 2 })}
            className="text-blue-500"
            title="Avg cost minus premiums collected in current cycle"
          />
          <Stat label="Premiums" value={formatCurrency(wheel.totalPremiums, { maximumFractionDigits: 0 })} className="text-green-600" />
          <Stat label="Break Even" value={formatCurrency(wheel.breakEven, { maximumFractionDigits: 2 })} />
          {wheel.activeOptions.nearestPut && (
            <Stat
              label="Put"
              value={`$${wheel.activeOptions.nearestPut.strike} (${wheel.activeOptions.nearestPut.dte}d)`}
            />
          )}
          {wheel.activeOptions.nearestCall && (
            <Stat
              label="Call"
              value={`$${wheel.activeOptions.nearestCall.strike} (${wheel.activeOptions.nearestCall.dte}d)`}
            />
          )}
          <Stat label="Cycles" value={`${wheel.completedCycles}/${wheel.cycleCount}`} />
          {wheel.totalPnL !== 0 && (
            <Stat
              label="Total P&L"
              value={formatCurrency(wheel.totalPnL, { maximumFractionDigits: 0 })}
              className={wheel.totalPnL >= 0 ? "text-green-600" : "text-red-600"}
            />
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, className, title }: {
  label: string;
  value: string;
  className?: string;
  title?: string;
}) {
  return (
    <div className="flex items-center gap-1.5" title={title}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`font-mono font-medium ${className ?? ""}`}>{value}</span>
    </div>
  );
}
