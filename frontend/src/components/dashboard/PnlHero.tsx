import type { DashboardSummary } from "@assup/shared";
import { formatCurrency } from "@assup/shared";

interface PnlHeroProps {
  periodTotal: DashboardSummary["periodTotal"];
  periodIncludesCurrentMonth: boolean;
}

export function PnlHero({ periodTotal, periodIncludesCurrentMonth }: PnlHeroProps) {
  const { total, realized, unrealized, projected } = periodTotal;
  const colorClass = total >= 0 ? "text-green-500" : "text-red-500";

  return (
    <div>
      <div className={`text-4xl font-bold tabular-nums ${colorClass}`}>
        {formatCurrency(total)}
      </div>
      <div className="text-sm text-muted-foreground mt-1">
        <span>Realized {formatCurrency(realized)}</span>
        {periodIncludesCurrentMonth && unrealized !== null && (
          <>
            <span className="mx-2">&middot;</span>
            <span>Unrealized {formatCurrency(unrealized)}</span>
          </>
        )}
        {periodIncludesCurrentMonth && projected !== null && (
          <>
            <span className="mx-2">&middot;</span>
            <span>Projected {formatCurrency(projected)}</span>
          </>
        )}
      </div>
    </div>
  );
}
