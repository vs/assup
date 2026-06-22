import type { DashboardSummary } from "@assup/shared";
import { formatCurrency } from "@assup/shared";
import { Card, CardContent } from "@/components/ui/card";

interface CurrentMonthPaceProps {
  data: DashboardSummary["currentMonthPace"];
}

export function CurrentMonthPace({ data }: CurrentMonthPaceProps) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between py-3 px-4">
        <span className="text-sm text-muted-foreground font-medium">Current Month</span>
        <div className="flex items-center gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">Realized </span>
            <span className={data.realized >= 0 ? "text-green-500" : "text-red-500"}>
              {formatCurrency(data.realized)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Projected </span>
            <span className="text-blue-400">{formatCurrency(data.projected)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Est. Total </span>
            <span className={data.estimatedTotal >= 0 ? "text-green-500" : "text-red-500"}>
              {formatCurrency(data.estimatedTotal)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">{data.daysRemaining}d left</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
