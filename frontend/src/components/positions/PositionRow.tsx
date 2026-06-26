import type { Position, AssetClass, SparklinePoint } from "@assup/shared";
import { formatCurrency, formatNumber, calculatePositionExposure } from "@assup/shared";
import { Link } from "react-router-dom";
import { TableCell, TableRow } from "@/components/ui/table";
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
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

function fmtPrice(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return formatCurrency(value, { maximumFractionDigits: 2 });
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

  const qty = Math.abs(position.position);
  const costPerUnit = qty > 0 ? position.costBasis / qty : 0;
  const pricePerUnit = qty > 0 && position.marketValue != null ? Math.abs(position.marketValue) / qty : null;
  const priceChangePct = costPerUnit > 0 && pricePerUnit != null
    ? ((pricePerUnit - costPerUnit) / costPerUnit) * 100
    : null;

  return (
    <TableRow className="text-sm">
      {/* Symbol */}
      <TableCell className="py-2">
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

      {/* Sparkline */}
      <TableCell className="w-16 py-2 pr-2">
        <Sparkline
          data={sparklineData}
          loading={sparklineLoading}
          error={sparklineError}
          onChartClick={!isCash ? () => onSymbolClick(position.underlying || position.symbol) : undefined}
        />
      </TableCell>

      {/* Asset Class (optional) */}
      {showAssetClassColumn && (
        <TableCell className="py-2">
          <AssetClassSelect
            value={position.assetClassId}
            disabled={isCash || assigning}
            onValueChange={onAssign}
            assetClasses={assetClasses}
            placeholder="—"
            className="w-28"
          />
        </TableCell>
      )}

      {/* Qty */}
      <TableCell className="text-right font-mono py-2">
        {formatNumber(position.position)}
      </TableCell>

      {/* Cost/u */}
      <TableCell className="text-right font-mono py-2 text-muted-foreground">
        {isCash ? "—" : fmtPrice(costPerUnit)}
      </TableCell>

      {/* Price/u */}
      <TableCell className="text-right font-mono py-2">
        {isCash || pricePerUnit == null ? "—" : fmtPrice(pricePerUnit)}
      </TableCell>

      {/* Change % */}
      <TableCell className={`text-right font-mono py-2 ${
        priceChangePct == null ? "" : priceChangePct >= 0 ? "text-green-600" : "text-red-600"
      }`}>
        {isCash || priceChangePct == null ? "—"
          : `${priceChangePct >= 0 ? "+" : ""}${priceChangePct.toFixed(1)}%`}
      </TableCell>

      {/* Cost */}
      <TableCell className="text-right font-mono py-2">
        {fmtCompact(position.costBasis)}
      </TableCell>

      {/* Value */}
      <TableCell className="text-right font-mono py-2">
        {position.marketValue != null ? fmtCompact(position.marketValue) : "—"}
      </TableCell>

      {/* P&L */}
      <TableCell className={`text-right font-mono py-2 ${
        position.unrealizedPnl != null && position.unrealizedPnl >= 0
          ? "text-green-600"
          : position.unrealizedPnl != null ? "text-red-600" : ""
      }`}>
        {position.unrealizedPnl != null
          ? `${position.unrealizedPnl >= 0 ? "+" : ""}${fmtCompact(position.unrealizedPnl)}`
          : "—"}
      </TableCell>

      {/* Exposure */}
      <TableCell className={`text-right font-mono py-2 ${
        isOption ? (exposure >= 0 ? "text-green-600" : "text-red-600") : ""
      }`}>
        {isOption && exposure >= 0 ? "+" : ""}{fmtCompact(exposure)}
      </TableCell>

      {/* % NLV */}
      <TableCell className={`text-right font-mono py-2 ${
        isOption ? (pct != null && pct >= 0 ? "text-green-600" : pct != null ? "text-red-600" : "") : ""
      }`}>
        {pct != null ? `${isOption && pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
      </TableCell>
    </TableRow>
  );
}
