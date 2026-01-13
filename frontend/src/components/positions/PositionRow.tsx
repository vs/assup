import type { Position, AssetClass, SparklinePoint } from "@assup/shared";
import { formatCurrency, formatNumber, calculatePositionExposure } from "@assup/shared";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AssetClassSelect, ExternalLinks } from "@/components/common";
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
  showPercentColumn?: boolean;
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
  showPercentColumn = true,
}: PositionRowProps) {
  const exposure = calculatePositionExposure(position);
  const pct = netLiquidation > 0 ? (exposure / netLiquidation) * 100 : null;
  const isCash = position.secType === "CASH";
  const isOption = position.secType === "OPT";

  return (
    <TableRow>
      {/* Symbol */}
      <TableCell>
        <div className="flex items-center">
          {isCash ? (
            <span className="font-medium">{position.symbol}</span>
          ) : (
            <>
              <button
                className="font-medium hover:text-primary hover:underline cursor-pointer text-left"
                onClick={() => onSymbolClick(position.underlying || position.symbol)}
              >
                {position.symbol}
              </button>
              <ExternalLinks symbol={position.underlying || position.symbol} />
            </>
          )}
        </div>
      </TableCell>

      {/* Sparkline */}
      <TableCell className="w-24">
        <Sparkline
          data={sparklineData}
          loading={sparklineLoading}
          error={sparklineError}
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

      {/* Quantity */}
      <TableCell className="text-right font-mono">
        {formatNumber(position.position)}
      </TableCell>

      {/* Cost Basis */}
      <TableCell className="text-right font-mono">
        {formatCurrency(position.costBasis)}
      </TableCell>

      {/* Market Value */}
      <TableCell className="text-right font-mono">
        {position.marketValue !== null ? (
          formatCurrency(position.marketValue)
        ) : (
          <span className="text-muted-foreground">N/A</span>
        )}
      </TableCell>

      {/* P&L */}
      <TableCell className={`text-right font-mono ${
        position.unrealizedPnl !== null && position.unrealizedPnl >= 0
          ? "text-green-600"
          : position.unrealizedPnl !== null
            ? "text-red-600"
            : ""
      }`}>
        {position.unrealizedPnl !== null ? (
          <>{position.unrealizedPnl >= 0 ? "+" : ""}{formatCurrency(position.unrealizedPnl)}</>
        ) : (
          <span className="text-muted-foreground">N/A</span>
        )}
      </TableCell>

      {/* Exposure */}
      <TableCell className={`text-right font-mono ${
        isOption ? (exposure >= 0 ? "text-green-600" : "text-red-600") : ""
      }`}>
        {isOption && exposure >= 0 ? "+" : ""}{formatCurrency(exposure)}
      </TableCell>

      {/* % of Total (optional) */}
      {showPercentColumn && (
        <TableCell className={`text-right font-mono ${
          isOption ? (pct !== null && pct >= 0 ? "text-green-600" : pct !== null ? "text-red-600" : "") : ""
        }`}>
          {pct !== null ? (
            `${isOption && pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
          ) : (
            <span className="text-muted-foreground">N/A</span>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}
