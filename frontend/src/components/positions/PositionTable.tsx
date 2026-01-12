import type { Position, AssetClass, SparklinePoint } from "@assup/shared";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExposureTooltip } from "@/components/common";
import { PositionRow } from "./PositionRow";

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
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Symbol</TableHead>
          <TableHead className="w-24">30D</TableHead>
          <TableHead>Type</TableHead>
          {showAssetClassColumn && <TableHead>Asset Class</TableHead>}
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Cost Basis</TableHead>
          <TableHead className="text-right">Mkt Value</TableHead>
          <TableHead className="text-right">P&L</TableHead>
          <TableHead className="text-right">
            <span className="inline-flex items-center gap-1">
              Exposure
              <ExposureTooltip />
            </span>
          </TableHead>
          {showPercentColumn && <TableHead className="text-right">% of Total</TableHead>}
          {showAssignColumn && <TableHead>Assign To</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((pos) => {
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
