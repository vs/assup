import type { PositionSummary, DashboardSettings } from "@assup/shared";
import { formatCurrency } from "@assup/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExposureTooltip } from "@/components/common";

interface AccountSummaryCardsProps {
  summary: PositionSummary;
  settings: DashboardSettings;
  hasOptionsPositions: boolean;
}

export function AccountSummaryCards({
  summary,
  settings,
  hasOptionsPositions,
}: AccountSummaryCardsProps) {
  const fmtCurrency = (value: number) => formatCurrency(value, { maximumFractionDigits: 0 });

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Net Liquidation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {fmtCurrency(summary.account.netLiquidation)}
          </div>
          {settings.includeOptions && summary.summary.totalStockValue !== summary.summary.totalValue && (
            <p className="text-xs text-muted-foreground">
              Stocks: {fmtCurrency(summary.summary.totalStockValue)}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Cash Value
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {fmtCurrency(summary.account.cashValue)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Positions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{summary.summary.totalPositions}</div>
        </CardContent>
      </Card>

      {hasOptionsPositions && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              Options Exposure
              <ExposureTooltip showStocks={false} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {fmtCurrency(
                settings.optionsWeightMode === "delta"
                  ? summary.summary.totalOptionsDelta
                  : summary.summary.totalOptionsNotional
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {settings.optionsWeightMode === "delta" ? "Delta-weighted" : "Notional"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
