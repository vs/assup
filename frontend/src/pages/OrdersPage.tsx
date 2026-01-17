import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import type { OrderImpact } from "@assup/shared";
import { formatCurrency, formatNumber } from "@assup/shared";
import { useOrderUpdates } from "@/hooks/useSSE";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartModal } from "@/components/ChartModal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader, ErrorAlert, PageLoadingSkeleton, ExternalLinks } from "@/components/common";

export function OrdersPage() {
  const [impact, setImpact] = useState<OrderImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

  // Subscribe to real-time order updates
  const handleOrderUpdate = useCallback(() => {
    loadData();
  }, []);
  useOrderUpdates(handleOrderUpdate);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const impactData = await api.orders.impact();
      setImpact(impactData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  const hasOrders = impact && impact.orders.length > 0;

  if (loading && !impact) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        subtitle="View your pending limit orders."
        loading={loading}
        onRefresh={loadData}
      />

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {/* Open Limit Orders */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Open Limit Orders
            {impact && <Badge variant="secondary">{impact.orders.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasOrders ? (
            <p className="text-muted-foreground text-center py-8">
              No open limit orders found.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Asset Class</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Bid</TableHead>
                  <TableHead className="text-right">Ask</TableHead>
                  <TableHead className="text-right">Limit Price</TableHead>
                  <TableHead className="text-right">Est. Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {impact.orders.map((order) => (
                  <TableRow key={order.orderId}>
                    <TableCell>
                      <div className="flex items-center">
                        <button
                          className="font-medium hover:text-primary hover:underline cursor-pointer text-left"
                          onClick={() => setChartSymbol(order.symbol)}
                        >
                          {order.displayName}
                        </button>
                        <ExternalLinks symbol={order.symbol} />
                      </div>
                    </TableCell>
                    <TableCell>
                      {order.secType === "OPT" && order.right ? (
                        <Badge variant={order.right === "P" ? "danger" : "success"}>
                          {order.right === "P" ? "PUT" : "CALL"}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Stock</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {order.assetClassName && order.assetClassId ? (
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: order.assetClassColor || "#6366f1" }}
                          />
                          <Link
                            to={`/positions?assetClassId=${order.assetClassId}`}
                            className="hover:text-primary hover:underline"
                          >
                            {order.assetClassName}
                          </Link>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={order.action === "BUY" ? "success" : "danger"}>
                        {order.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(order.quantity)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {order.bid != null ? formatCurrency(order.bid) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {order.ask != null ? formatCurrency(order.ask) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(order.limitPrice || 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(order.estimatedValue || 0)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{order.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ChartModal
        symbol={chartSymbol}
        open={!!chartSymbol}
        onClose={() => setChartSymbol(null)}
      />
    </div>
  );
}
