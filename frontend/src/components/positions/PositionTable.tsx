import { useCallback } from "react";
import type { Position, AssetClass, SparklinePoint } from "@assup/shared";
import { calculatePositionExposure } from "@assup/shared";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExposureTooltip, SortableHead } from "@/components/common";
import { PositionRow } from "./PositionRow";
import { useTableSort } from "@/hooks/useTableSort";

interface SparklineState {
  data: SparklinePoint[];
  loading: boolean;
  error: boolean;
}

interface PositionTableProps {
  positions: Position[];
  assetClasses: AssetClass[];
  netLiquidation: number;
  assigningKey: string | null;
  onAssign: (position: Position, assetClassId: string) => void;
  onSymbolClick: (symbol: string) => void;
  getSparkline: (position: Position) => SparklineState;
  showAssetClassColumn?: boolean;
  showPercentColumn?: boolean;
  showAssignColumn?: boolean;
}

export function PositionTable({
  positions,
  assetClasses,
  netLiquidation,
  assigningKey,
  onAssign,
  onSymbolClick,
  getSparkline,
  showAssetClassColumn = true,
  showPercentColumn = true,
  showAssignColumn = false,
}: PositionTableProps) {
  const getColumnValue = useCallback((pos: Position, col: string): string | number => {
    switch (col) {
      case "symbol": return pos.symbol;
      case "type": {
        if (pos.secType === "OPT") return pos.right === "P" ? "PUT" : "CALL";
        if (pos.secType === "CASH") return "Cash";
        return "Stock";
      }
      case "assetClass": return pos.assetClassName ?? "";
      case "quantity": return pos.position;
      case "costBasis": return pos.costBasis ?? 0;
      case "mktValue": return pos.marketValue ?? 0;
      case "pnl": return pos.unrealizedPnl ?? 0;
      case "exposure": return calculatePositionExposure(pos);
      case "pctOfTotal": return netLiquidation > 0 ? calculatePositionExposure(pos) / netLiquidation : 0;
      default: return 0;
    }
  }, [netLiquidation]);

  const { sorted, sortColumn, sortDir, toggleSort } = useTableSort(positions, getColumnValue);

  // When no explicit sort, keep cash at bottom
  const displayPositions = sortColumn ? sorted : [...positions].sort((a, b) => {
    if (a.secType === "CASH") return 1;
    if (b.secType === "CASH") return -1;
    return 0;
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead column="symbol" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Symbol</SortableHead>
          <TableHead className="w-24">1M</TableHead>
          <SortableHead column="type" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Type</SortableHead>
          {showAssetClassColumn && (
            <SortableHead column="assetClass" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Asset Class</SortableHead>
          )}
          <SortableHead column="quantity" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Quantity</SortableHead>
          <SortableHead column="costBasis" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Cost Basis</SortableHead>
          <SortableHead column="mktValue" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Mkt Value</SortableHead>
          <SortableHead column="pnl" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>P&L</SortableHead>
          <SortableHead column="exposure" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>
            <span className="inline-flex items-center gap-1">
              Exposure
              <ExposureTooltip />
            </span>
          </SortableHead>
          {showPercentColumn && (
            <SortableHead column="pctOfTotal" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>% of Total</SortableHead>
          )}
          {showAssignColumn && <TableHead>Assign To</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {displayPositions.map((pos) => {
          const key = `${pos.symbol}:${pos.secType}`;
          const sparkline = getSparkline(pos);
          return (
            <PositionRow
              key={key}
              position={pos}
              sparklineData={sparkline.data}
              sparklineLoading={sparkline.loading}
              sparklineError={sparkline.error}
              netLiquidation={netLiquidation}
              assigning={assigningKey === key}
              onAssign={(assetClassId) => onAssign(pos, assetClassId)}
              onSymbolClick={onSymbolClick}
              assetClasses={assetClasses}
              showAssetClassColumn={showAssetClassColumn}
              showPercentColumn={showPercentColumn}
            />
          );
        })}
      </TableBody>
    </Table>
  );
}
