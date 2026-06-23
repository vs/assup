import type { DashboardSummary } from "@assup/shared";
import { formatCurrency } from "@assup/shared";
import { Card, CardContent } from "@/components/ui/card";

interface CurrentMonthPaceProps {
  data: DashboardSummary["currentMonthPace"];
}

export function CurrentMonthPace({ data }: CurrentMonthPaceProps) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">Current Month</span>
          <span className="text-xs text-muted-foreground">{data.daysRemaining}d left</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs">Realized</span>
            <div className={`tabular-nums font-semibold ${data.realized >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(data.realized)}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Projected</span>
            <div className="tabular-nums font-semibold text-blue-600">
              {formatCurrency(data.projected)}
            </div>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Est. Total</span>
            <div className={`tabular-nums font-semibold ${data.estimatedTotal >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(data.estimatedTotal)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
