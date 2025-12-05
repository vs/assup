import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { AllocationProfile, PositionSummary } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

interface AllocationData {
  name: string;
  current: number;
  target: number;
  diff: number;
  color: string;
  value: number;
}

export function DashboardPage() {
  const [profile, setProfile] = useState<AllocationProfile | null>(null);
  const [summary, setSummary] = useState<PositionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [profileData, summaryData] = await Promise.all([
        api.allocationProfiles.getActive().catch(() => null),
        api.positions.summary().catch(() => null),
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
        name: target.assetClass.name,
        target: target.targetPercentage,
        current: actual?.percentage || 0,
        diff: (actual?.percentage || 0) - target.targetPercentage,
        color: target.assetClass.color,
        value: actual?.value || 0,
      });
    }

    // Add unassigned if any
    if (summary.summary.unassignedPercentage > 0) {
      allocationData.push({
        name: "Unassigned",
        target: 0,
        current: summary.summary.unassignedPercentage,
        diff: summary.summary.unassignedPercentage,
        color: "#9ca3af",
        value: summary.summary.unassignedValue,
      });
    }

    // Add actuals that don't have targets
    for (const actual of summary.summary.byAssetClass) {
      if (!targetMap.has(actual.id)) {
        allocationData.push({
          name: actual.name,
          target: 0,
          current: actual.percentage,
          diff: actual.percentage,
          color: actual.color,
          value: actual.value,
        });
      }
    }
  }

  // Pie chart data (current allocation)
  const pieData = allocationData
    .filter((d) => d.current > 0)
    .map((d) => ({
      name: d.name,
      value: d.current,
      color: d.color,
    }));

  if (loading) {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Allocation Dashboard</h1>
        <p className="text-muted-foreground">
          Monitor your portfolio allocation vs. target.
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Account Summary */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Current Allocation</CardTitle>
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
              <ResponsiveContainer width="100%" height={300}>
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
                    <th className="text-right py-3 px-2">Target</th>
                    <th className="text-right py-3 px-2">Current</th>
                    <th className="text-right py-3 px-2">Difference</th>
                    <th className="text-right py-3 px-2">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {allocationData.map((row) => (
                    <tr key={row.name} className="border-b">
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: row.color }}
                          />
                          {row.name}
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
                        {formatCurrency(row.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
