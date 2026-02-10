import { useState, useEffect } from "react";
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

interface Props {
  year: number;
}

export function StockTradesTable({ year }: Props) {
  const [trades, setTrades] = useState<TaxStockTrade[]>([]);
  const [totals, setTotals] = useState({ income: 0, expenses: 0, profit: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const data = await taxesApi.stockTrades(year);
        setTrades(data.trades);
        setTotals(data.totals);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [year]);

  const formatCzk = (value: number | null) =>
    value !== null
      ? new Intl.NumberFormat("cs-CZ", {
          style: "currency",
          currency: "CZK",
          maximumFractionDigits: 0,
        }).format(value)
      : "—";

  const formatUsd = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);

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
            {trades.length} trades | Profit: {formatCzk(totals.profit)}
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
                  className={
                    trade.status === "missing_buy"
                      ? "bg-yellow-50 dark:bg-yellow-950/20"
                      : trade.isExempt
                        ? "bg-gray-50 dark:bg-gray-900/20"
                        : undefined
                  }
                >
                  <TableCell>{trade.dateClosed}</TableCell>
                  <TableCell className="font-medium">{trade.symbol}</TableCell>
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
                    {formatCzk(trade.pnlCzk)}
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
    </Card>
  );
}
