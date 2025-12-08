import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { OrderImpact } from "@/lib/api";
import { useOrderUpdates } from "@/hooks/useSSE";
import { Button } from "@/components/ui/button";
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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { RefreshCw } from "lucide-react";

export function OrdersPage() {
  const [impact, setImpact] = useState<OrderImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const formatNumber = (value: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);

  // Prepare chart data
  const chartData = impact
    ? impact.currentAllocation.map((curr) => {
        const proj = impact.projectedAllocation.find((p) => p.id === curr.id);
        return {
          name: curr.name,
          current: curr.percentage,
          projected: proj?.percentage || 0,
          color: curr.color,
        };
      })
    : [];

  const hasOrders = impact && impact.orders.length > 0;
  const valueChange = impact
    ? impact.totalProjectedValue - impact.totalCurrentValue
    : 0;

  if (loading && !impact) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Orders Impact Analysis</h1>
          <p className="text-muted-foreground">
            See how your pending limit orders would affect allocation if executed.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

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
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Limit Price</TableHead>
                  <TableHead>Asset Class</TableHead>
                  <TableHead className="text-right">Est. Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {impact.orders.map((order) => (
                  <TableRow key={order.orderId}>
                    <TableCell className="font-medium">{order.symbol}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{order.secType}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={order.action === "BUY" ? "default" : "secondary"}>
                        {order.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(order.quantity)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(order.limitPrice || 0)}
                    </TableCell>
                    <TableCell>
                      {order.assetClassName ? (
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: order.assetClassColor || "#6366f1" }}
                          />
                          {order.assetClassName}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
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

      {/* Impact Visualization */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Summary Cards */}
        <Card>
          <CardHeader>
            <CardTitle>Portfolio Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Current</div>
                <div className="text-2xl font-bold">
                  {formatCurrency(impact?.totalCurrentValue || 0)}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Projected</div>
                <div className="text-2xl font-bold">
                  {formatCurrency(impact?.totalProjectedValue || 0)}
                </div>
              </div>
            </div>
            {hasOrders && valueChange !== 0 && (
              <div className="mt-4 pt-4 border-t">
                <div className="text-sm text-muted-foreground">Change</div>
                <div
                  className={`text-xl font-bold ${
                    valueChange > 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {valueChange > 0 ? "+" : ""}
                  {formatCurrency(valueChange)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Allocation Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No allocation data available
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(250, chartData.length * 40)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
                  <XAxis type="number" domain={[0, "dataMax"]} unit="%" />
                  <YAxis type="category" dataKey="name" width={80} />
                  <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                  <Legend />
                  <Bar dataKey="current" name="Current" fill="#6366f1" />
                  <Bar dataKey="projected" name="Projected" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Allocation Table */}
      <Card>
        <CardHeader>
          <CardTitle>Allocation Details</CardTitle>
        </CardHeader>
        <CardContent>
          {!impact || impact.currentAllocation.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No allocation data available
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset Class</TableHead>
                  <TableHead className="text-right">Current %</TableHead>
                  <TableHead className="text-right">Projected %</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Current Value</TableHead>
                  <TableHead className="text-right">Projected Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {impact.currentAllocation.map((curr) => {
                  const proj = impact.projectedAllocation.find((p) => p.id === curr.id);
                  const pctChange = (proj?.percentage || 0) - curr.percentage;
                  return (
                    <TableRow key={curr.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: curr.color }}
                          />
                          {curr.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{curr.percentage.toFixed(1)}%</TableCell>
                      <TableCell className="text-right">
                        {(proj?.percentage || 0).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            pctChange > 0.1
                              ? "text-green-600"
                              : pctChange < -0.1
                              ? "text-red-600"
                              : ""
                          }
                        >
                          {pctChange > 0 ? "+" : ""}
                          {pctChange.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(curr.value)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(proj?.value || 0)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
