import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { AllocationProfile, PositionSummary, DashboardSettings } from "@/lib/api";
import { useAllocationUpdates } from "@/hooks/useSSE";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { RefreshCw } from "lucide-react";

interface AllocationData {
  id: string | null; // Asset class ID for linking, null for "Unassigned"
  name: string;
  current: number;
  target: number;
  diff: number;
  color: string;
  value: number;
  stockValue: number;
  optionsExposure: number;
}

const DEFAULT_SETTINGS: DashboardSettings = {
  includeOptions: false,
  optionsWeightMode: "notional",
};

export function DashboardPage() {
  const [profile, setProfile] = useState<AllocationProfile | null>(null);
  const [summary, setSummary] = useState<PositionSummary | null>(null);
  const [settings, setSettings] = useState<DashboardSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to real-time allocation updates
  const handleAllocationUpdate = useCallback(() => {
    // Silently refresh data when allocation changes
    loadData();
  }, []);
  useAllocationUpdates(handleAllocationUpdate);

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    try {
      setLoading(true);
      // Load settings first
      const savedSettings = await api.settings.getDashboard().catch(() => DEFAULT_SETTINGS);
      setSettings(savedSettings);

      // Then load data with those settings
      const [profileData, summaryData] = await Promise.all([
        api.allocationProfiles.getActive().catch(() => null),
        api.positions.summary({
          includeOptions: savedSettings.includeOptions,
          optionsWeightMode: savedSettings.optionsWeightMode,
        }).catch(() => null),
      ]);
      setProfile(profileData);
      setSummary(summaryData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function loadData() {
    try {
      setLoading(true);
      const [profileData, summaryData] = await Promise.all([
        api.allocationProfiles.getActive().catch(() => null),
        api.positions.summary({
          includeOptions: settings.includeOptions,
          optionsWeightMode: settings.optionsWeightMode,
        }).catch(() => null),
      ]);
      setProfile(profileData);
      setSummary(summaryData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function updateSettings(newSettings: Partial<DashboardSettings>) {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);

    // Save to backend
    try {
      await api.settings.setDashboard(updated);
    } catch (err) {
      console.error("Failed to save settings:", err);
    }

    // Reload data with new settings
    loadData();
  }

  // Combine target and actual allocation data
  const allocationData: AllocationData[] = [];
  if (profile && summary) {
    const targetMap = new Map(
      profile.targets.map((t) => [t.assetClassId, t])
    );
    const actualMap = new Map(
      summary.summary.byAssetClass.map((a) => [a.id, a])
    );

    // Add all targets
    for (const target of profile.targets) {
      const actual = actualMap.get(target.assetClassId);
      allocationData.push({
        id: target.assetClassId,
        name: target.assetClass.name,
        target: target.targetPercentage,
        current: Math.round(actual?.percentage || 0),
        diff: (actual?.percentage || 0) - target.targetPercentage,
        color: target.assetClass.color,
        value: actual?.value || 0,
        stockValue: actual?.stockValue || 0,
        optionsExposure: settings.optionsWeightMode === "delta"
          ? (actual?.optionsDelta || 0)
          : (actual?.optionsNotional || 0),
      });
    }

    // Add unassigned if any
    if (summary.summary.unassignedPercentage > 0) {
      allocationData.push({
        id: "unassigned",
        name: "Unassigned",
        target: 0,
        current: Math.round(summary.summary.unassignedPercentage),
        diff: summary.summary.unassignedPercentage,
        color: "#9ca3af",
        value: summary.summary.unassignedValue,
        stockValue: summary.summary.unassignedValue,
        optionsExposure: 0,
      });
    }

    // Add actuals that don't have targets
    for (const actual of summary.summary.byAssetClass) {
      if (!targetMap.has(actual.id)) {
        allocationData.push({
          id: actual.id,
          name: actual.name,
          target: 0,
          current: Math.round(actual.percentage),
          diff: actual.percentage,
          color: actual.color,
          value: actual.value,
          stockValue: actual.stockValue,
          optionsExposure: settings.optionsWeightMode === "delta"
            ? actual.optionsDelta
            : actual.optionsNotional,
        });
      }
    }
  }

  // Pie chart data (current allocation)
  const pieData = allocationData
    .filter((d) => d.current > 0)
    .map((d) => ({
      id: d.id,
      name: d.name,
      value: d.current,
      color: d.color,
    }));

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading dashboard...</p>
      </div>
    );
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

  const hasOptionsPositions = summary?.summary.optionsExposure &&
    summary.summary.optionsExposure.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Allocation Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor your portfolio allocation vs. target.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="include-options"
              checked={settings.includeOptions}
              onCheckedChange={(checked) => updateSettings({ includeOptions: checked })}
            />
            <Label htmlFor="include-options" className="text-sm cursor-pointer">
              Include Options
            </Label>
          </div>

          {settings.includeOptions && (
            <Select
              value={settings.optionsWeightMode}
              onValueChange={(v: "notional" | "delta") =>
                updateSettings({ optionsWeightMode: v })
              }
            >
              <SelectTrigger className="w-36 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="notional">Notional</SelectItem>
                <SelectItem value="delta">Delta-weighted</SelectItem>
              </SelectContent>
            </Select>
          )}

          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Account Summary */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Net Liquidation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(summary.account.netLiquidation)}
              </div>
              {settings.includeOptions && summary.summary.totalStockValue !== summary.summary.totalValue && (
                <p className="text-xs text-muted-foreground">
                  Stocks: {formatCurrency(summary.summary.totalStockValue)}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Cash Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(summary.account.cashValue)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Positions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.summary.totalPositions}</div>
            </CardContent>
          </Card>
          {hasOptionsPositions && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Options Exposure
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(
                    settings.optionsWeightMode === "delta"
                      ? summary.summary.totalOptionsDelta
                      : summary.summary.totalOptionsNotional
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {settings.optionsWeightMode === "delta" ? "Delta-weighted" : "Notional"}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Current Allocation
              {settings.includeOptions && (
                <Badge variant="outline" className="font-normal text-xs">
                  {settings.optionsWeightMode === "delta" ? "Delta" : "Notional"}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No positions to display
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ name, value }) => `${name}: ${value.toFixed(1)}%`}
                    labelLine={false}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Bar Chart - Target vs Actual */}
        <Card>
          <CardHeader>
            <CardTitle>Target vs Current</CardTitle>
          </CardHeader>
          <CardContent>
            {allocationData.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                {profile ? "No allocation data" : "No active allocation profile"}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(300, allocationData.length * 40)}>
                <BarChart
                  data={allocationData}
                  layout="vertical"
                  margin={{ left: 80, right: 20 }}
                >
                  <XAxis type="number" domain={[0, "dataMax"]} unit="%" />
                  <YAxis type="category" dataKey="name" width={80} />
                  <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} />
                  <Legend />
                  <Bar dataKey="target" name="Target" fill="#6366f1" />
                  <Bar dataKey="current" name="Current" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Options Exposure Breakdown */}
      {settings.includeOptions && hasOptionsPositions && (
        <Card>
          <CardHeader>
            <CardTitle>Options Exposure by Asset Class</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2">Asset Class</th>
                    <th className="text-right py-3 px-2">Stock Value</th>
                    <th className="text-right py-3 px-2">Options {settings.optionsWeightMode === "delta" ? "Delta" : "Notional"}</th>
                    <th className="text-right py-3 px-2">Total Exposure</th>
                  </tr>
                </thead>
                <tbody>
                  {allocationData
                    .filter((row) => row.optionsExposure !== 0)
                    .map((row) => (
                      <tr key={row.name} className="border-b">
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: row.color }}
                            />
                            {row.id ? (
                              <Link
                                to={`/positions?assetClassId=${row.id}`}
                                className="hover:text-primary hover:underline"
                              >
                                {row.name}
                              </Link>
                            ) : (
                              row.name
                            )}
                          </div>
                        </td>
                        <td className="text-right py-3 px-2 font-mono">
                          {formatCurrency(row.stockValue)}
                        </td>
                        <td className="text-right py-3 px-2 font-mono">
                          <span className={row.optionsExposure > 0 ? "text-green-600" : "text-red-600"}>
                            {row.optionsExposure > 0 ? "+" : ""}
                            {formatCurrency(row.optionsExposure)}
                          </span>
                        </td>
                        <td className="text-right py-3 px-2 font-mono font-semibold">
                          {formatCurrency(row.value)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Allocation Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Allocation Details
            {profile && (
              <Badge variant="secondary" className="font-normal">
                Profile: {profile.name}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {allocationData.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              Connect to TWS and set up an allocation profile to see details.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2">Asset Class</th>
                    <th className="text-right py-3 px-2">Target %</th>
                    <th className="text-right py-3 px-2">Current %</th>
                    <th className="text-right py-3 px-2">Diff %</th>
                    <th className="text-right py-3 px-2">Target Value</th>
                    <th className="text-right py-3 px-2">Current Value</th>
                    <th className="text-right py-3 px-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {allocationData.map((row) => {
                    const netLiq = summary?.account.netLiquidation ?? 0;
                    const targetValue = (row.target / 100) * netLiq;
                    const diffValue = row.value - targetValue;
                    return (
                      <tr key={row.name} className="border-b">
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: row.color }}
                            />
                            {row.id ? (
                              <Link
                                to={`/positions?assetClassId=${row.id}`}
                                className="hover:text-primary hover:underline"
                              >
                                {row.name}
                              </Link>
                            ) : (
                              row.name
                            )}
                          </div>
                        </td>
                        <td className="text-right py-3 px-2">
                          {row.target.toFixed(1)}%
                        </td>
                        <td className="text-right py-3 px-2">
                          {row.current.toFixed(1)}%
                        </td>
                        <td className="text-right py-3 px-2">
                          <span
                            className={
                              row.diff > 0.5
                                ? "text-green-600"
                                : row.diff < -0.5
                                ? "text-red-600"
                                : ""
                            }
                          >
                            {row.diff > 0 ? "+" : ""}
                            {row.diff.toFixed(1)}%
                          </span>
                        </td>
                        <td className="text-right py-3 px-2 font-mono">
                          {formatCurrency(targetValue)}
                        </td>
                        <td className="text-right py-3 px-2 font-mono">
                          {formatCurrency(row.value)}
                        </td>
                        <td className="text-right py-3 px-2">
                          {diffValue < -1 && row.id ? (
                            <Badge variant="success" asChild>
                              <Link to={`/scanner?assetClassId=${row.id}`}>
                                BUY {formatCurrency(Math.abs(diffValue))}
                              </Link>
                            </Badge>
                          ) : diffValue > 1 && row.id ? (
                            <Badge variant="danger" asChild>
                              <Link to={`/scanner?assetClassId=${row.id}`}>
                                SELL {formatCurrency(diffValue)}
                              </Link>
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
