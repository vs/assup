import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { OrderImpact } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Plus, Trash2, RefreshCw } from "lucide-react";

interface SimulatedOrder {
  id: string;
  symbol: string;
  secType: string;
  action: "BUY" | "SELL";
  quantity: number;
  price: number;
}

export function OrdersPage() {
  const [impact, setImpact] = useState<OrderImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Simulated orders
  const [simOrders, setSimOrders] = useState<SimulatedOrder[]>([]);
  const [newOrder, setNewOrder] = useState({
    symbol: "",
    action: "BUY" as "BUY" | "SELL",
    quantity: "",
    price: "",
  });

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

  function addSimulatedOrder() {
    if (!newOrder.symbol || !newOrder.quantity || !newOrder.price) return;

    const order: SimulatedOrder = {
      id: Date.now().toString(),
      symbol: newOrder.symbol.toUpperCase(),
      secType: "STK",
      action: newOrder.action,
      quantity: parseFloat(newOrder.quantity),
      price: parseFloat(newOrder.price),
    };

    setSimOrders([...simOrders, order]);
    setNewOrder({ symbol: "", action: "BUY", quantity: "", price: "" });
  }

  function removeSimulatedOrder(id: string) {
    setSimOrders(simOrders.filter((o) => o.id !== id));
  }

  async function simulateImpact() {
    if (simOrders.length === 0) return;

    try {
      setLoading(true);
      const result = await api.orders.simulate(
        simOrders.map((o) => ({
          symbol: o.symbol,
          secType: o.secType,
          action: o.action,
          quantity: o.quantity,
          price: o.price,
        }))
      );
      setImpact(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to simulate");
    } finally {
      setLoading(false);
    }
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
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
            Simulate how orders would affect your portfolio allocation.
          </p>
        </div>
        <Button variant="outline" onClick={loadData} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Order Simulator */}
      <Card>
        <CardHeader>
          <CardTitle>Simulate Orders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label>Symbol</Label>
              <Input
                value={newOrder.symbol}
                onChange={(e) => setNewOrder({ ...newOrder, symbol: e.target.value.toUpperCase() })}
                placeholder="AAPL"
              />
            </div>
            <div className="space-y-2">
              <Label>Action</Label>
              <Select
                value={newOrder.action}
                onValueChange={(v: "BUY" | "SELL") => setNewOrder({ ...newOrder, action: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUY">Buy</SelectItem>
                  <SelectItem value="SELL">Sell</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                value={newOrder.quantity}
                onChange={(e) => setNewOrder({ ...newOrder, quantity: e.target.value })}
                placeholder="100"
              />
            </div>
            <div className="space-y-2">
              <Label>Price</Label>
              <Input
                type="number"
                step="0.01"
                value={newOrder.price}
                onChange={(e) => setNewOrder({ ...newOrder, price: e.target.value })}
                placeholder="150.00"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={addSimulatedOrder} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>
          </div>

          {simOrders.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {simOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.symbol}</TableCell>
                      <TableCell>
                        <Badge variant={order.action === "BUY" ? "default" : "secondary"}>
                          {order.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{order.quantity}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(order.price)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(order.quantity * order.price)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeSimulatedOrder(order.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Button onClick={simulateImpact} disabled={loading}>
                Calculate Impact
              </Button>
            </>
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
            {impact && impact.totalProjectedValue !== impact.totalCurrentValue && (
              <div className="mt-4 pt-4 border-t">
                <div className="text-sm text-muted-foreground">Change</div>
                <div
                  className={`text-xl font-bold ${
                    impact.totalProjectedValue > impact.totalCurrentValue
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {impact.totalProjectedValue > impact.totalCurrentValue ? "+" : ""}
                  {formatCurrency(impact.totalProjectedValue - impact.totalCurrentValue)}
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
              <ResponsiveContainer width="100%" height={250}>
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
