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
}: PositionTableProps) {
  const getColumnValue = useCallback((pos: Position, col: string): string | number => {
    const qty = Math.abs(pos.position);
    switch (col) {
      case "symbol": return pos.symbol;
      case "assetClass": return pos.assetClassName ?? "";
      case "qty": return pos.position;
      case "costUnit": return qty > 0 ? pos.costBasis / qty : 0;
      case "priceUnit": return qty > 0 && pos.marketValue != null ? Math.abs(pos.marketValue) / qty : 0;
      case "change": {
        if (qty <= 0 || pos.marketValue == null) return 0;
        const cost = pos.costBasis / qty;
        return cost > 0 ? ((Math.abs(pos.marketValue) / qty - cost) / cost) * 100 : 0;
      }
      case "cost": return pos.costBasis;
      case "value": return pos.marketValue ?? 0;
      case "pnl": return pos.unrealizedPnl ?? 0;
      case "exposure": return calculatePositionExposure(pos);
      case "pctNlv": return netLiquidation > 0 ? calculatePositionExposure(pos) / netLiquidation : 0;
      default: return 0;
    }
  }, [netLiquidation]);

  const { sorted, sortColumn, sortDir, toggleSort } = useTableSort(positions, getColumnValue);

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
          <TableHead className="w-16">1M</TableHead>
          {showAssetClassColumn && (
            <SortableHead column="assetClass" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Class</SortableHead>
          )}
          <SortableHead column="qty" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Qty</SortableHead>
          <SortableHead column="costUnit" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Cost/u</SortableHead>
          <SortableHead column="priceUnit" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Price</SortableHead>
          <SortableHead column="change" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Chg%</SortableHead>
          <SortableHead column="cost" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Cost</SortableHead>
          <SortableHead column="value" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>Value</SortableHead>
          <SortableHead column="pnl" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>P&L</SortableHead>
          <SortableHead column="exposure" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>
            <span className="inline-flex items-center gap-1">
              Exp
              <ExposureTooltip />
            </span>
          </SortableHead>
          <SortableHead column="pctNlv" className="text-right" sortColumn={sortColumn} sortDir={sortDir} toggleSort={toggleSort}>%</SortableHead>
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
            />
          );
        })}
      </TableBody>
    </Table>
  );
}
