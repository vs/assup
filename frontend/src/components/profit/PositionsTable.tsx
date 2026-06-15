import { useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import type { CurrentOptionPosition, Order, ActiveSpread } from "@assup/shared";
import { formatCurrency } from "@assup/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExternalLinks, SortableHead } from "@/components/common";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";
import { Sparkline } from "@/components/Sparkline";
import { useSparklines } from "@/hooks/useSparklines";
import { useTableSort } from "@/hooks/useTableSort";
import { ChevronRight, ChevronDown } from "lucide-react";
import {
  groupOpenPositionsIntoSpreads,
  formatLiveSpreadName,
  spreadTypeBadgeProps,
  type OpenPositionSpreadGroup,
} from "@/utils/spreadGrouping";
import { api } from "@/api";
import { CloseSpreadDialog } from "@/components/iron-condor/CloseSpreadDialog";

// Helper to calculate days to expiration using US Eastern timezone
function calculateDTE(expiry: string): number {
  const eastern = (d: Date) => {
    const s = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    return new Date(s + "T00:00:00");
  };
  const todayET = eastern(new Date());
  const expiryDate = new Date(expiry + "T00:00:00");
  return Math.ceil((expiryDate.getTime() - todayET.getTime()) / (1000 * 60 * 60 * 24));
}

interface PositionsTableProps {
  positions: CurrentOptionPosition[];
  openOrders: Order[];
  onSymbolClick: (symbol: string) => void;
  onClosePosition: (pos: CurrentOptionPosition, existingOrder: Order | null) => void;
  onSpreadClosed?: () => void;
}

export function PositionsTable({
  positions,
  openOrders,
  onSymbolClick,
  onClosePosition,
  onSpreadClosed,
}: PositionsTableProps) {
  // Match a position to its existing BUY order
  const findMatchingOrder = useCallback((pos: CurrentOptionPosition): Order | undefined => {
    return openOrders.find(
      (o) => o.action === "BUY" && o.secType === "OPT" && o.displayName === pos.displayName
    );
  }, [openOrders]);

  // Group positions into spreads
  const { spreads, ungrouped } = useMemo(
    () => groupOpenPositionsIntoSpreads(positions),
    [positions],
  );

  // Get unique underlying symbols for sparklines
  const sparklineSymbols = useMemo(() => {
    const symbols = new Set<string>();
    for (const pos of positions) {
      symbols.add(pos.underlying);
    }
    return Array.from(symbols);
  }, [positions]);

  const { getSparklineState } = useSparklines(sparklineSymbols);

  // Sort only ungrouped positions
  const getExpiringValue = useCallback((pos: CurrentOptionPosition, col: string): string | number => {
    switch (col) {
      case "contract": return pos.displayName;
      case "type": return pos.right;
      case "assetClass": return pos.assetClassName ?? "";
      case "price": return pos.underlyingPrice ?? 0;
      case "strike": return pos.strike;
      case "expiry": return pos.expiry;
      case "dte": return calculateDTE(pos.expiry);
      case "qty": return pos.quantity;
      case "unrealizedPnl": return pos.unrealizedPnl;
      case "projected": return pos.projectedProfit;
      default: return 0;
    }
  }, []);
  const expSort = useTableSort(ungrouped, getExpiringValue);

  if (positions.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-4">
        No open positions
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead column="contract" {...expSort}>Contract</SortableHead>
          <TableHead className="w-24" />
          <SortableHead column="type" {...expSort}>Type</SortableHead>
          <SortableHead column="assetClass" {...expSort}>Asset Class</SortableHead>
          <SortableHead column="price" className="text-right" {...expSort}>Price</SortableHead>
          <SortableHead column="strike" className="text-right" {...expSort}>Strike</SortableHead>
          <SortableHead column="expiry" {...expSort}>Expiry</SortableHead>
          <SortableHead column="dte" className="text-right" {...expSort}>DTE</SortableHead>
          <SortableHead column="qty" className="text-right" {...expSort}>Qty</SortableHead>
          <SortableHead column="unrealizedPnl" className="text-right" {...expSort}>Unrealized P&L</SortableHead>
          <SortableHead column="projected" className="text-right" {...expSort}>Projected</SortableHead>
          <TableHead className="text-right">Order</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {spreads.map((spread, idx) => (
          <OpenSpreadRow
            key={`spread-${idx}`}
            spread={spread}
            getSparklineState={getSparklineState}
            onSymbolClick={onSymbolClick}
            findMatchingOrder={findMatchingOrder}
            onClosePosition={onClosePosition}
            onSpreadClosed={onSpreadClosed}
          />
        ))}
        {expSort.sorted.map((pos) => {
          const sparkline = getSparklineState(pos.underlying);
          const dte = calculateDTE(pos.expiry);
          const matchingOrder = findMatchingOrder(pos);
          return (
            <TableRow key={pos.displayName}>
              <TableCell>
                <div className={`flex items-center${spreads.length > 0 ? " pl-5" : ""}`}>
                  <TickerHoverCard symbol={pos.underlying}>
                    <Link
                      to={`/tickers/${pos.underlying}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {pos.displayName}
                    </Link>
                  </TickerHoverCard>
                  <ExternalLinks symbol={pos.underlying} />
                </div>
              </TableCell>
              <TableCell>
                <Sparkline
                  data={sparkline.data}
                  loading={sparkline.loading}
                  error={sparkline.error}
                  onChartClick={() => onSymbolClick(pos.underlying)}
                />
              </TableCell>
              <TableCell>
                <Badge variant={pos.right === "P" ? "danger" : "success"}>
                  {pos.right === "P" ? "PUT" : "CALL"}
                </Badge>
              </TableCell>
              <TableCell>
                {pos.assetClassName ? (
                  <Link
                    to={`/positions?assetClassId=${pos.assetClassId}`}
                    className="flex items-center gap-2 hover:text-primary"
                  >
                    <div
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: pos.assetClassColor }}
                    />
                    <span className="truncate text-sm">{pos.assetClassName}</span>
                  </Link>
                ) : (
                  <span className="text-muted-foreground text-sm">-</span>
                )}
              </TableCell>
              <TableCell className="text-right font-mono">
                {pos.underlyingPrice != null
                  ? `$${pos.underlyingPrice.toFixed(2)}`
                  : <span className="text-muted-foreground">-</span>}
              </TableCell>
              <TableCell className="text-right font-mono">
                ${pos.strike.toFixed(pos.strike % 1 === 0 ? 0 : 2)}
              </TableCell>
              <TableCell>{pos.expiry}</TableCell>
              <TableCell className={`text-right font-mono ${dte <= 7 ? "text-red-600" : ""}`}>
                {dte}
              </TableCell>
              <TableCell className="text-right font-mono">{pos.quantity}</TableCell>
              <TableCell
                className={`text-right font-mono ${
                  pos.unrealizedPnl >= 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {formatCurrency(pos.unrealizedPnl)}
              </TableCell>
              <TableCell className="text-right font-mono text-blue-600">
                {formatCurrency(pos.projectedProfit)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {matchingOrder ? (
                  <span
                    className="cursor-pointer group/order relative"
                    onClick={() => onClosePosition(pos, matchingOrder)}
                  >
                    {formatCurrency(matchingOrder.limitPrice ?? 0)} x {matchingOrder.quantity}
                    <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/order:opacity-100 bg-background text-sm font-sans">
                      Adjust
                    </span>
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onClosePosition(pos, null)}
                  >
                    Close
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function OpenSpreadRow({
  spread,
  getSparklineState,
  onSymbolClick,
  findMatchingOrder,
  onClosePosition,
  onSpreadClosed,
}: {
  spread: OpenPositionSpreadGroup;
  getSparklineState: (symbol: string) => { data: { date: string; close: number }[]; loading: boolean; error: boolean };
  onSymbolClick: (symbol: string) => void;
  findMatchingOrder: (pos: CurrentOptionPosition) => Order | undefined;
  onClosePosition: (pos: CurrentOptionPosition, existingOrder: Order | null) => void;
  onSpreadClosed?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [closingSpread, setClosingSpread] = useState<ActiveSpread | null>(null);
  const [closeLoading, setCloseLoading] = useState(false);
  const badge = spreadTypeBadgeProps(spread.type);
  const displayName = formatLiveSpreadName(spread.type, spread.underlying, spread.legs);
  const sparkline = getSparklineState(spread.underlying);
  const dte = calculateDTE(spread.expiry);
  const strikes = spread.legs.map(l => l.strike).sort((a, b) => a - b);
  const fmtStrike = (s: number) => s % 1 === 0 ? s.toString() : s.toFixed(2);

  const handleCloseSpread = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCloseLoading(true);
    try {
      const { spreads: activeSpreads } = await api.ironCondor.getActiveSpreads();
      const spreadStrikes = strikes.map(fmtStrike).join("/");
      const match = activeSpreads.find((as) => {
        const asStrikes = as.legs.map(l => l.strike).sort((a, b) => a - b);
        const asFmt = asStrikes.map(s => s % 1 === 0 ? s.toString() : s.toFixed(2)).join("/");
        return as.symbol === spread.underlying
          && as.expiry === spread.expiry.replace(/-/g, "")
          && asFmt === spreadStrikes;
      });
      if (match) {
        setClosingSpread(match);
      }
    } catch {
      // silent
    } finally {
      setCloseLoading(false);
    }
  };

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell>
          <div className="flex items-center gap-1.5">
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            }
            <TickerHoverCard symbol={spread.underlying}>
              <Link
                to={`/tickers/${spread.underlying}`}
                className="font-medium hover:text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {displayName}
              </Link>
            </TickerHoverCard>
            <ExternalLinks symbol={spread.underlying} />
          </div>
        </TableCell>
        <TableCell>
          <Sparkline
            data={sparkline.data}
            loading={sparkline.loading}
            error={sparkline.error}
            onChartClick={() => onSymbolClick(spread.underlying)}
          />
        </TableCell>
        <TableCell>
          <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${badge.className}`}>
            {badge.label}
          </span>
        </TableCell>
        <TableCell>
          {spread.assetClassName ? (
            <Link
              to={`/positions?assetClassId=${spread.assetClassId}`}
              className="flex items-center gap-2 hover:text-primary"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: spread.assetClassColor }}
              />
              <span className="truncate text-sm">{spread.assetClassName}</span>
            </Link>
          ) : (
            <span className="text-muted-foreground text-sm">-</span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono">
          {spread.underlyingPrice != null
            ? `$${spread.underlyingPrice.toFixed(2)}`
            : <span className="text-muted-foreground">-</span>}
        </TableCell>
        <TableCell className="text-right font-mono text-muted-foreground">
          {strikes.map(fmtStrike).join("/")}
        </TableCell>
        <TableCell>{spread.expiry}</TableCell>
        <TableCell className={`text-right font-mono ${dte <= 7 ? "text-red-600" : ""}`}>
          {dte}
        </TableCell>
        <TableCell className="text-right font-mono">{spread.quantity}</TableCell>
        <TableCell
          className={`text-right font-mono ${
            spread.totalUnrealizedPnl >= 0 ? "text-green-600" : "text-red-600"
          }`}
        >
          {formatCurrency(spread.totalUnrealizedPnl)}
        </TableCell>
        <TableCell className="text-right font-mono text-blue-600">
          {formatCurrency(spread.totalProjectedProfit)}
        </TableCell>
        <TableCell className="text-right font-mono">
          <Button
            variant="ghost"
            size="sm"
            disabled={closeLoading}
            onClick={handleCloseSpread}
          >
            Close
          </Button>
        </TableCell>
      </TableRow>
      <CloseSpreadDialog
        open={!!closingSpread}
        onOpenChange={(open) => { if (!open) setClosingSpread(null); }}
        spread={closingSpread}
        onSuccess={() => { setClosingSpread(null); onSpreadClosed?.(); }}
      />
      {expanded && spread.legs.map((leg) => {
        const legDte = calculateDTE(leg.expiry);
        const legOrder = findMatchingOrder(leg);
        return (
          <TableRow key={leg.displayName} className="bg-muted/30">
            <TableCell className="pl-9 text-sm text-muted-foreground">
              {leg.quantity < 0 ? "Short" : "Long"} {leg.right === "P" ? "Put" : "Call"} {leg.strike}
            </TableCell>
            <TableCell />
            <TableCell>
              <Badge variant={leg.right === "P" ? "danger" : "success"} className="text-[10px]">
                {leg.right === "P" ? "PUT" : "CALL"}
              </Badge>
            </TableCell>
            <TableCell />
            <TableCell className="text-right font-mono text-xs">
              {leg.underlyingPrice != null ? `$${leg.underlyingPrice.toFixed(2)}` : "-"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              ${leg.strike.toFixed(leg.strike % 1 === 0 ? 0 : 2)}
            </TableCell>
            <TableCell className="text-xs">{leg.expiry}</TableCell>
            <TableCell className={`text-right font-mono text-xs ${legDte <= 7 ? "text-red-600" : ""}`}>
              {legDte}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">{leg.quantity}</TableCell>
            <TableCell className={`text-right font-mono text-xs ${
              leg.unrealizedPnl >= 0 ? "text-green-600" : "text-red-600"
            }`}>
              {formatCurrency(leg.unrealizedPnl)}
            </TableCell>
            <TableCell className="text-right font-mono text-xs text-blue-600">
              {formatCurrency(leg.projectedProfit)}
            </TableCell>
            <TableCell className="text-right font-mono">
              {legOrder ? (
                <span
                  className="cursor-pointer group/order relative text-xs"
                  onClick={(e) => { e.stopPropagation(); onClosePosition(leg, legOrder); }}
                >
                  {formatCurrency(legOrder.limitPrice ?? 0)} x {legOrder.quantity}
                  <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/order:opacity-100 bg-background text-sm font-sans">
                    Adjust
                  </span>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7"
                  onClick={(e) => { e.stopPropagation(); onClosePosition(leg, null); }}
                >
                  Close
                </Button>
              )}
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}
