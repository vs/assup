import type { DashboardSummary } from "@assup/shared";
import { formatCurrency } from "@assup/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CurrentMonthPaceProps {
  data: DashboardSummary["currentMonthPace"];
}

export function CurrentMonthPace({ data }: CurrentMonthPaceProps) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Current Month</CardTitle>
          <Badge variant="outline" className="text-xs font-normal">
            {data.daysRemaining}d left
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Realized</span>
            <span className={`tabular-nums font-semibold ${data.realized >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(data.realized)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Projected</span>
            <span className="tabular-nums font-semibold text-blue-600">
              {formatCurrency(data.projected)}
            </span>
          </div>
          <div className="flex justify-between border-t pt-1.5 mt-1.5">
            <span className="font-semibold">Est. Total</span>
            <span className={`tabular-nums font-semibold ${data.estimatedTotal >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(data.estimatedTotal)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
