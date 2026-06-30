import { memo } from "react";
import { Link } from "react-router-dom";
import type { Position, SparklinePoint } from "@assup/shared";
import { formatCurrency, formatNumber, calculatePositionExposure } from "@assup/shared";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ExposureTooltip, ExternalLinks } from "@/components/common";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";
import { Sparkline } from "@/components/Sparkline";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AllocationData {
  id: string | null;
  name: string;
  current: number;
  target: number;
  diff: number;
  color: string;
  value: number;
  stockValue: number;
  optionsExposure: number;
}

interface SparklineState {
  data: SparklinePoint[];
  loading: boolean;
  error: boolean;
}

interface GroupedPositionsTableProps {
  positions: Position[];
  allocationData: AllocationData[];
  netLiquidation: number;
  includeOptions: boolean;
  onSymbolClick: (symbol: string) => void;
  getSparkline: (position: Position) => SparklineState;
  expandedGroups: Set<string>;
  onToggleGroup: (groupId: string) => void;
}

const fmtCurrency = (value: number) => formatCurrency(value, { maximumFractionDigits: 0 });

// Grid columns: Symbol | 1M | Qty | Cost/u | Price | Chg% | Cost | Value | P&L | Exp | %
const GRID_COLS = "minmax(140px,2.5fr) 60px minmax(50px,0.7fr) minmax(60px,1fr) minmax(60px,1fr) minmax(50px,0.8fr) minmax(55px,1fr) minmax(55px,1fr) minmax(60px,1fr) minmax(55px,1fr) minmax(35px,0.5fr)";

export function GroupedPositionsTable({
  positions,
  allocationData,
  netLiquidation,
  includeOptions,
  onSymbolClick,
  getSparkline,
  expandedGroups,
  onToggleGroup,
}: GroupedPositionsTableProps) {
  // Group positions by asset class ID
  const positionsByClass = new Map<string, Position[]>();
  for (const pos of positions) {
    const key = pos.assetClassId ?? "unassigned";
    if (!positionsByClass.has(key)) positionsByClass.set(key, []);
    positionsByClass.get(key)!.push(pos);
  }

  // Sort cash positions last within each group
  for (const [, group] of positionsByClass) {
    group.sort((a, b) => {
      if (a.secType === "CASH") return 1;
      if (b.secType === "CASH") return -1;
      return 0;
    });
  }

  return (
    <div>
      <div className="w-full">
        {allocationData.map((row) => {
          const groupId = row.id ?? "unassigned";
          const isExpanded = expandedGroups.has(groupId);
          const groupPositions = positionsByClass.get(groupId) ?? [];
          const targetValue = (row.target / 100) * netLiquidation;
          const currentValue = includeOptions ? row.value : row.stockValue;
          const currentPct = netLiquidation > 0 ? (currentValue / netLiquidation) * 100 : 0;
          const diffPct = currentPct - row.target;
          const diffValue = currentValue - targetValue;

          return (
            <AssetClassGroup
              key={groupId}
              row={{ ...row, current: currentPct, diff: diffPct }}
              groupId={groupId}
              isExpanded={isExpanded}
              onToggle={() => onToggleGroup(groupId)}
              positions={groupPositions}
              targetValue={targetValue}
              currentValue={currentValue}
              diffValue={diffValue}
              netLiquidation={netLiquidation}
              onSymbolClick={onSymbolClick}
              getSparkline={getSparkline}
              gridCols={GRID_COLS}
            />
          );
        })}
      </div>
    </div>
  );
}

interface AssetClassGroupProps {
  row: AllocationData;
  groupId: string;
  isExpanded: boolean;
  onToggle: () => void;
  positions: Position[];
  targetValue: number;
  currentValue: number;
  diffValue: number;
  netLiquidation: number;
  onSymbolClick: (symbol: string) => void;
  getSparkline: (position: Position) => SparklineState;
  gridCols: string;
}

const AssetClassGroup = memo(function AssetClassGroup({
  row,
  groupId,
  isExpanded,
  onToggle,
  positions,
  targetValue,
  currentValue,
  diffValue,
  netLiquidation,
  onSymbolClick,
  getSparkline,
  gridCols,
}: AssetClassGroupProps) {
  const isUnassigned = groupId === "unassigned";

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            "grid w-full items-center bg-muted/30 hover:bg-muted/40 cursor-pointer select-none border-b py-3",
            isExpanded && "border-b-0"
          )}
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="flex items-center gap-2 pl-2 col-span-3">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: row.color }}
            />
            <span className="font-semibold text-sm">{row.name}</span>
            {positions.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {positions.length}
              </span>
            )}
          </div>
          <div className="text-right pr-2">
            {!isUnassigned && <DiffIndicator diff={row.diff} />}
          </div>
          <div className="col-span-2" />
          <div className="text-right font-mono pr-2 text-sm">
            {!isUnassigned && (
              <div>
                <span className="font-medium">{fmtCurrency(targetValue)}</span>
                <span className="text-xs text-muted-foreground ml-1">{row.target.toFixed(0)}%</span>
              </div>
            )}
          </div>
          <div className="text-right font-mono pr-2 text-sm font-medium">
            <div>
              <span>{fmtCurrency(currentValue)}</span>
              <span className="text-xs text-muted-foreground ml-1">{row.current.toFixed(0)}%</span>
            </div>
          </div>
          <div className="text-right pr-2 col-span-3">
            <ActionBadge id={row.id} diffValue={diffValue} />
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Inline column headers */}
        <div
          className="grid w-full bg-muted/5 text-xs text-muted-foreground border-b"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="pl-8 py-1 font-medium">Symbol</div>
          <div className="py-1 font-medium">1M</div>
          <div className="text-right py-1 pr-2 font-medium">Qty</div>
          <div className="text-right py-1 pr-2 font-medium">Cost/u</div>
          <div className="text-right py-1 pr-2 font-medium">Price</div>
          <div className="text-right py-1 pr-2 font-medium">Chg%</div>
          <div className="text-right py-1 pr-2 font-medium">Cost</div>
          <div className="text-right py-1 pr-2 font-medium">Value</div>
          <div className="text-right py-1 pr-2 font-medium">P&L</div>
          <div className="text-right py-1 pr-2 font-medium">
            <span className="inline-flex items-center gap-1">
              Exp
              <ExposureTooltip />
            </span>
          </div>
          <div className="text-right py-1 pr-2 font-medium">%</div>
        </div>
        {positions.map((pos) => {
          const key = `${pos.symbol}:${pos.secType}`;
          const sparkline = getSparkline(pos);
          return (
            <PositionGridRow
              key={key}
              position={pos}
              sparklineData={sparkline.data}
              sparklineLoading={sparkline.loading}
              sparklineError={sparkline.error}
              netLiquidation={netLiquidation}
              onSymbolClick={onSymbolClick}
              gridCols={gridCols}
            />
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
});

interface PositionGridRowProps {
  position: Position;
  sparklineData: SparklinePoint[];
  sparklineLoading: boolean;
  sparklineError: boolean;
  netLiquidation: number;
  onSymbolClick: (symbol: string) => void;
  gridCols: string;
}

function fmtPrice(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return formatCurrency(value, { maximumFractionDigits: 2 });
}

function fmtCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(0)}K`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

const PositionGridRow = memo(function PositionGridRow({
  position,
  sparklineData,
  sparklineLoading,
  sparklineError,
  netLiquidation,
  onSymbolClick,
  gridCols,
}: PositionGridRowProps) {
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
    <div
      className="grid w-full items-center hover:bg-muted/30 border-b py-1.5 text-sm"
      style={{ gridTemplateColumns: gridCols }}
    >
      {/* Symbol */}
      <div className="pl-8 font-medium flex items-center">
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

      {/* Sparkline */}
      <div className="pr-2">
        <Sparkline
          data={sparklineData}
          loading={sparklineLoading}
          error={sparklineError}
          onChartClick={!isCash ? () => onSymbolClick(position.underlying || position.symbol) : undefined}
        />
      </div>

      {/* Qty */}
      <div className="text-right font-mono pr-2">
        {formatNumber(position.position)}
      </div>

      {/* Cost/u */}
      <div className="text-right font-mono pr-2 text-muted-foreground">
        {isCash ? "—" : fmtPrice(costPerUnit)}
      </div>

      {/* Price */}
      <div className="text-right font-mono pr-2">
        {isCash || pricePerUnit == null ? "—" : fmtPrice(pricePerUnit)}
      </div>

      {/* Chg% */}
      <div className={`text-right font-mono pr-2 ${
        priceChangePct == null ? "" : priceChangePct >= 0 ? "text-green-600" : "text-red-600"
      }`}>
        {isCash || priceChangePct == null ? "—"
          : `${priceChangePct >= 0 ? "+" : ""}${priceChangePct.toFixed(1)}%`}
      </div>

      {/* Cost */}
      <div className="text-right font-mono pr-2">
        {fmtCompact(position.costBasis)}
      </div>

      {/* Value */}
      <div className="text-right font-mono pr-2">
        {position.marketValue != null ? fmtCompact(position.marketValue) : "—"}
      </div>

      {/* P&L */}
      <div className={`text-right font-mono pr-2 ${
        position.unrealizedPnl != null && position.unrealizedPnl >= 0
          ? "text-green-600"
          : position.unrealizedPnl != null ? "text-red-600" : ""
      }`}>
        {position.unrealizedPnl != null
          ? `${position.unrealizedPnl >= 0 ? "+" : ""}${fmtCompact(position.unrealizedPnl)}`
          : "—"}
      </div>

      {/* Exp */}
      <div className={`text-right font-mono pr-2 ${
        isOption ? (exposure >= 0 ? "text-green-600" : "text-red-600") : ""
      }`}>
        {isOption && exposure >= 0 ? "+" : ""}{fmtCompact(exposure)}
      </div>

      {/* % */}
      <div className={`text-right font-mono pr-2 ${
        isOption ? (pct != null && pct >= 0 ? "text-green-600" : pct != null ? "text-red-600" : "") : ""
      }`}>
        {pct != null ? `${isOption && pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
      </div>
    </div>
  );
});

function DiffIndicator({ diff }: { diff: number }) {
  const color = diff > 0.5 ? "text-green-600" : diff < -0.5 ? "text-red-600" : "text-muted-foreground";
  return (
    <span className={`font-medium font-mono ${color}`}>
      {diff > 0 ? "+" : ""}{diff.toFixed(1)}%
    </span>
  );
}

function ActionBadge({ id, diffValue }: { id: string | null; diffValue: number }) {
  if (!id || id === "unassigned") return null;

  if (diffValue < -1) {
    return (
      <Badge variant="success" asChild>
        <Link
          to={`/scanner?assetClassId=${id}`}
          onClick={(e) => e.stopPropagation()}
        >
          BUY {fmtCurrency(Math.abs(diffValue))}
        </Link>
      </Badge>
    );
  }

  if (diffValue > 1) {
    return (
      <Badge variant="danger" asChild>
        <Link
          to={`/scanner?assetClassId=${id}`}
          onClick={(e) => e.stopPropagation()}
        >
          SELL {fmtCurrency(diffValue)}
        </Link>
      </Badge>
    );
  }

  return null;
}
