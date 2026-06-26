import type { Position, AssetClass, SparklinePoint } from "@assup/shared";
import { formatCurrency, formatNumber, calculatePositionExposure } from "@assup/shared";
import { Link } from "react-router-dom";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AssetClassSelect, ExternalLinks } from "@/components/common";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";
import { Sparkline } from "@/components/Sparkline";

interface PositionRowProps {
  position: Position;
  sparklineData: SparklinePoint[];
  sparklineLoading: boolean;
  sparklineError: boolean;
  netLiquidation: number;
  assigning: boolean;
  onAssign: (assetClassId: string) => void;
  onSymbolClick: (symbol: string) => void;
  assetClasses: AssetClass[];
  showAssetClassColumn?: boolean;
}

function fmtCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(0)}K`;
  return formatCurrency(value);
}

export function PositionRow({
  position,
  sparklineData,
  sparklineLoading,
  sparklineError,
  netLiquidation,
  assigning,
  onAssign,
  onSymbolClick,
  assetClasses,
  showAssetClassColumn = true,
}: PositionRowProps) {
  const exposure = calculatePositionExposure(position);
  const pct = netLiquidation > 0 ? (exposure / netLiquidation) * 100 : null;
  const isCash = position.secType === "CASH";
  const isOption = position.secType === "OPT";

  // Per-unit calculations
  const qty = Math.abs(position.position);
  const costPerUnit = qty > 0 ? position.costBasis / qty : 0;
  const pricePerUnit = qty > 0 && position.marketValue != null ? Math.abs(position.marketValue) / qty : null;
  const priceChange = pricePerUnit != null ? pricePerUnit - costPerUnit : null;
  const priceChangePct = costPerUnit > 0 && priceChange != null ? (priceChange / costPerUnit) * 100 : null;

  return (
    <TableRow>
      {/* Symbol */}
      <TableCell>
        <div className="flex items-center">
          {isCash ? (
            <span className="font-medium">{position.symbol}</span>
          ) : (
            <>
              <TickerHoverCard symbol={position.underlying || position.symbol}>
                <Link
                  to={`/tickers/${position.underlying || position.symbol}`}
                  className="font-medium hover:text-primary hover:underline"
                >
                  {position.symbol}
                </Link>
              </TickerHoverCard>
              <ExternalLinks symbol={position.underlying || position.symbol} />
            </>
          )}
        </div>
      </TableCell>

      {/* Sparkline (1M) */}
      <TableCell className="w-20 pr-3">
        <Sparkline
          data={sparklineData}
          loading={sparklineLoading}
          error={sparklineError}
          onChartClick={!isCash ? () => onSymbolClick(position.underlying || position.symbol) : undefined}
        />
      </TableCell>

      {/* Type */}
      <TableCell>
        {isOption && position.right ? (
          <Badge variant={position.right === "P" ? "danger" : "success"}>
            {position.right === "P" ? "PUT" : "CALL"}
          </Badge>
        ) : isCash ? (
          <Badge variant="outline">Cash</Badge>
        ) : (
          <Badge variant="outline">Stock</Badge>
        )}
      </TableCell>

      {/* Asset Class (optional) */}
      {showAssetClassColumn && (
        <TableCell>
          <AssetClassSelect
            value={position.assetClassId}
            disabled={isCash || assigning}
            onValueChange={onAssign}
            assetClasses={assetClasses}
            placeholder="Assign..."
            className="w-44"
          />
        </TableCell>
      )}

      {/* Qty */}
      <TableCell className="text-right font-mono">
        {formatNumber(position.position)}
      </TableCell>

      {/* Cost/unit */}
      <TableCell className="text-right font-mono text-muted-foreground">
        {isCash ? "—" : formatCurrency(costPerUnit)}
      </TableCell>

      {/* Price/unit */}
      <TableCell className="text-right font-mono">
        {isCash || pricePerUnit == null ? "—" : formatCurrency(pricePerUnit)}
      </TableCell>

      {/* Change/unit */}
      <TableCell className={`text-right font-mono text-xs ${
        priceChange == null ? "" : priceChange >= 0 ? "text-green-600" : "text-red-600"
      }`}>
        {isCash || priceChange == null ? "—" : (
          <span>
            {priceChange >= 0 ? "+" : ""}{formatCurrency(priceChange)}
            {priceChangePct != null && (
              <span className="text-muted-foreground ml-0.5">
                ({priceChangePct >= 0 ? "+" : ""}{priceChangePct.toFixed(1)}%)
              </span>
            )}
          </span>
        )}
      </TableCell>

      {/* Cost (total) */}
      <TableCell className="text-right font-mono">
        {fmtCompact(position.costBasis)}
      </TableCell>

      {/* Value (total) */}
      <TableCell className="text-right font-mono">
        {position.marketValue != null ? fmtCompact(position.marketValue) : "—"}
      </TableCell>

      {/* P&L */}
      <TableCell className={`text-right font-mono ${
        position.unrealizedPnl != null && position.unrealizedPnl >= 0
          ? "text-green-600"
          : position.unrealizedPnl != null ? "text-red-600" : ""
      }`}>
        {position.unrealizedPnl != null ? (
          <>{position.unrealizedPnl >= 0 ? "+" : ""}{formatCurrency(position.unrealizedPnl)}</>
        ) : "—"}
      </TableCell>

      {/* Exposure */}
      <TableCell className={`text-right font-mono ${
        isOption ? (exposure >= 0 ? "text-green-600" : "text-red-600") : ""
      }`}>
        {isOption && exposure >= 0 ? "+" : ""}{fmtCompact(exposure)}
      </TableCell>

      {/* % of NLV */}
      <TableCell className={`text-right font-mono ${
        isOption ? (pct != null && pct >= 0 ? "text-green-600" : pct != null ? "text-red-600" : "") : ""
      }`}>
        {pct != null ? `${isOption && pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
      </TableCell>
    </TableRow>
  );
}
