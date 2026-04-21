import { useState, useEffect, useMemo } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { taxesApi } from "@/api/taxes";
import type { TaxStockTrade } from "@assup/shared";
import { LotTraceModal } from "./LotTraceModal";
import { formatCzk, formatUsd } from "./formatters";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";
import { useTickerProfileContext } from "@/components/common/TickerProfileProvider";

interface Props {
  year: number;
}

export function StockTradesTable({ year }: Props) {
  const [trades, setTrades] = useState<TaxStockTrade[]>([]);
  const [totals, setTotals] = useState({ income: 0, expenses: 0, profit: 0, profitUsd: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const { prefetch } = useTickerProfileContext();

  const uniqueSymbols = useMemo(
    () => [...new Set(trades.map((t) => t.symbol))],
    [trades]
  );

  useEffect(() => {
    if (uniqueSymbols.length) {
      prefetch(uniqueSymbols);
    }
  }, [uniqueSymbols, prefetch]);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const data = await taxesApi.stockTrades(year);
        setTrades(data.trades);
        // Calculate USD total from trades (only non-exempt, complete trades)
        const profitUsd = data.trades
          .filter((t) => !t.isExempt && t.status === "complete")
          .reduce((sum, t) => sum + t.pnlUsd, 0);
        setTotals({ ...data.totals, profitUsd });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [year]);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">Loading stock trades...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex justify-between">
          <span>Stock Trades (§10 D - Cenné papíry)</span>
          <span className="text-sm font-normal">
            {trades.length} trades | Profit: {formatCzk(totals.profit)} ({formatUsd(totals.profitUsd)})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date Closed</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Date Opened</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Proceeds</TableHead>
                <TableHead className="text-right">Cost Basis</TableHead>
                <TableHead className="text-right">P&L (CZK)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => (
                <TableRow
                  key={trade.id}
                  className={`cursor-pointer hover:bg-muted/50 ${
                    trade.status === "missing_buy"
                      ? "bg-yellow-50 dark:bg-yellow-950/20"
                      : trade.isExempt
                        ? "bg-gray-50 dark:bg-gray-900/20"
                        : ""
                  }`}
                  onClick={() => setSelectedSymbol(trade.symbol)}
                >
                  <TableCell>{trade.dateClosed}</TableCell>
                  <TableCell className="font-medium">
                    <TickerHoverCard symbol={trade.symbol}>
                      <span className="cursor-default">{trade.symbol}</span>
                    </TickerHoverCard>
                  </TableCell>
                  <TableCell className="text-right">{trade.quantity}</TableCell>
                  <TableCell>{trade.dateOpened || "—"}</TableCell>
                  <TableCell className="text-right">
                    {trade.holdingDays ?? "—"}
                    {trade.isExempt && (
                      <span className="ml-1 text-xs text-green-600">
                        (exempt)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div>{formatCzk(trade.proceedsCzk)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatUsd(trade.proceedsUsd)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div>{formatCzk(trade.costBasisCzk)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatUsd(trade.costBasisUsd)}
                    </div>
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      (trade.pnlCzk ?? 0) >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    <div>{formatCzk(trade.pnlCzk)}</div>
                    <div className="text-xs text-muted-foreground font-normal">
                      {formatUsd(trade.pnlUsd)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {trade.status === "complete" ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <div className="flex items-center gap-1 text-yellow-600">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="text-xs">Missing buy</span>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {trades.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    No stock trades found for {year}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <LotTraceModal
        symbol={selectedSymbol}
        onClose={() => setSelectedSymbol(null)}
      />
    </Card>
  );
}
