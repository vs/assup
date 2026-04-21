import { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import type { CurrentOptionPosition, Order } from "@assup/shared";
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
}

export function PositionsTable({
  positions,
  openOrders,
  onSymbolClick,
  onClosePosition,
}: PositionsTableProps) {
  // Match a position to its existing BUY order
  const findMatchingOrder = useCallback((pos: CurrentOptionPosition): Order | undefined => {
    return openOrders.find(
      (o) => o.action === "BUY" && o.secType === "OPT" && o.displayName === pos.displayName
    );
  }, [openOrders]);

  // Get unique underlying symbols for sparklines
  const sparklineSymbols = useMemo(() => {
    const symbols = new Set<string>();
    for (const pos of positions) {
      symbols.add(pos.underlying);
    }
    return Array.from(symbols);
  }, [positions]);

  const { getSparklineState } = useSparklines(sparklineSymbols);

  // Sort: expiring positions
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
  const expSort = useTableSort(positions, getExpiringValue);

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
        {expSort.sorted.map((pos) => {
          const sparkline = getSparklineState(pos.underlying);
          const dte = calculateDTE(pos.expiry);
          const matchingOrder = findMatchingOrder(pos);
          return (
            <TableRow key={pos.displayName}>
              <TableCell>
                <div className="flex items-center">
                  <TickerHoverCard symbol={pos.underlying}>
                    <a
                      href={`https://www.tradingview.com/chart/?symbol=${pos.underlying}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {pos.displayName}
                    </a>
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
