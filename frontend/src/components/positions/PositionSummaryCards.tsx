import { Link } from "react-router-dom";
import { formatCurrency } from "@assup/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PositionSummaryCardsProps {
  hasAnyMarketValue: boolean;
  isAllClasses: boolean;
  netLiquidation: number;
  totalExposure: number;
  stocksMarketValue: number;
  totalPnl: number;
  targetValue: number | null;
  targetPercentage: number | null;
  diffToTarget: number | null;
  assetClassId: string | null;
}

export function PositionSummaryCards({
  hasAnyMarketValue,
  isAllClasses,
  netLiquidation,
  totalExposure,
  stocksMarketValue,
  totalPnl,
  targetValue,
  targetPercentage,
  diffToTarget,
  assetClassId,
}: PositionSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Market Value
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hasAnyMarketValue ? (
            <div className="text-2xl font-bold">
              {formatCurrency(isAllClasses ? netLiquidation : totalExposure)}
            </div>
          ) : (
            <div className="text-2xl font-bold text-muted-foreground">N/A</div>
          )}
          {stocksMarketValue > 0 && (
            <p className="text-xs text-muted-foreground">
              Stocks: {formatCurrency(stocksMarketValue)}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Unrealized P&L
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hasAnyMarketValue ? (
            <div className={`text-2xl font-bold ${totalPnl >= 0 ? "text-green-600" : "text-red-600"}`}>
              {totalPnl >= 0 ? "+" : ""}{formatCurrency(totalPnl)}
            </div>
          ) : (
            <div className="text-2xl font-bold text-muted-foreground">N/A</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Target Value
          </CardTitle>
        </CardHeader>
        <CardContent>
          {targetValue !== null ? (
            <>
              <div className="text-2xl font-bold">{formatCurrency(targetValue)}</div>
              <p className="text-xs text-muted-foreground">
                {targetPercentage?.toFixed(1)}% of {formatCurrency(netLiquidation)}
              </p>
            </>
          ) : (
            <div className="text-2xl font-bold text-muted-foreground">-</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Action
          </CardTitle>
        </CardHeader>
        <CardContent>
          {diffToTarget !== null && diffToTarget < -1 && assetClassId ? (
            <Badge variant="success" asChild className="text-base px-3 py-1">
              <Link to={`/scanner?assetClassId=${assetClassId}`}>
                BUY {formatCurrency(Math.abs(diffToTarget))}
              </Link>
            </Badge>
          ) : diffToTarget !== null && diffToTarget > 1 && assetClassId ? (
            <Badge variant="danger" asChild className="text-base px-3 py-1">
              <Link to={`/scanner?assetClassId=${assetClassId}`}>
                SELL {formatCurrency(diffToTarget)}
              </Link>
            </Badge>
          ) : diffToTarget !== null ? (
            <div className="text-2xl font-bold text-muted-foreground">On target</div>
          ) : (
            <div className="text-2xl font-bold text-muted-foreground">-</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
