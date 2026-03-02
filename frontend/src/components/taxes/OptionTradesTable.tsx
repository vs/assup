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
import { Badge } from "@/components/ui/badge";
import { taxesApi } from "@/api/taxes";
import type { TaxOptionTrade } from "@assup/shared";
import { OptionLotTraceModal } from "./OptionLotTraceModal";
import { formatCzk, formatUsd } from "./formatters";

interface Props {
  year: number;
}

export function OptionTradesTable({ year }: Props) {
  const [trades, setTrades] = useState<TaxOptionTrade[]>([]);
  const [totals, setTotals] = useState({ income: 0, expenses: 0, profit: 0, profitUsd: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const data = await taxesApi.optionTrades(year);
        setTrades(data.trades);
        // Calculate USD total from trades (only complete trades)
        const profitUsd = data.trades
          .filter((t) => t.status === "complete")
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

  const getCloseTypeBadge = (type: string) => {
    switch (type) {
      case "assigned":
        return <Badge variant="secondary">Assigned</Badge>;
      case "expired":
        return <Badge variant="outline">Expired</Badge>;
      default:
        return <Badge>Closed</Badge>;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">Loading option trades...</p>
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
          <span>Option Trades (§10 F - Deriváty)</span>
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
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Close Type</TableHead>
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
                    trade.status === "missing_open"
                      ? "bg-yellow-50 dark:bg-yellow-950/20"
                      : ""
                  }`}
                  onClick={() => setSelectedSymbol(trade.symbol)}
                >
                  <TableCell>{trade.dateClosed}</TableCell>
                  <TableCell>
                    <div className="font-medium">{trade.symbol}</div>
                    <div className="text-xs text-muted-foreground">
                      {trade.description}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{trade.quantity}</TableCell>
                  <TableCell>{getCloseTypeBadge(trade.closeType)}</TableCell>
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
                      trade.pnlCzk >= 0 ? "text-green-600" : "text-red-600"
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
                        <span className="text-xs">Missing open</span>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {trades.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    No option trades found for {year}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <OptionLotTraceModal
        symbol={selectedSymbol}
        onClose={() => setSelectedSymbol(null)}
      />
    </Card>
  );
}
