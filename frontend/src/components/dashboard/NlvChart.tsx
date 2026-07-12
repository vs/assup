import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import type { FundFlowPoint } from "@assup/shared";
import { formatCurrency } from "@assup/shared";
import { dashboardApi } from "@/api/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type TimeRange = "1Y" | "3Y" | "5Y" | "ALL";

function getFromDate(range: TimeRange): string | undefined {
  if (range === "ALL") return undefined;
  const d = new Date();
  const years = range === "1Y" ? 1 : range === "3Y" ? 3 : 5;
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split("T")[0];
}

interface ChartDataPoint {
  date: string;
  netLiquidation: number;
  fundFlows: FundFlowPoint[];
}

function NlvTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ChartDataPoint;
  return (
    <div className="bg-popover border rounded-md p-3 text-sm shadow-md">
      <div className="font-medium mb-1">{d.date}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Net Liquidation</span>
        <span>{formatCurrency(d.netLiquidation)}</span>
      </div>
      {d.fundFlows.length > 0 && (
        <div className="mt-1 pt-1 border-t space-y-1">
          {d.fundFlows.map((ff, i) => (
            <div key={i}>
              <div className="flex justify-between gap-4">
                <span className={ff.amount >= 0 ? "text-green-600" : "text-red-600"}>
                  {ff.amount >= 0 ? "DEPOSIT" : "WITHDRAWAL"}
                </span>
                <span>
                  {formatCurrency(ff.amount)} {ff.currency}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">{ff.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NlvChart() {
  const [range, setRange] = useState<TimeRange>("1Y");

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "account-history", range],
    queryFn: () =>
      dashboardApi.accountHistory({
        from: getFromDate(range),
      }),
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Account Value</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground text-sm">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.snapshots.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Account Value</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground text-sm">
            No account history data.{" "}
            <span className="text-xs">
              Configure your IBKR FLEX Query to include the Equity Summary section, then re-import.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Build chart data, merge fund flows by date (multiple flows possible per date)
  const fundFlowsByDate = new Map<string, FundFlowPoint[]>();
  for (const ff of data.fundFlows) {
    const existing = fundFlowsByDate.get(ff.date);
    if (existing) {
      existing.push(ff);
    } else {
      fundFlowsByDate.set(ff.date, [ff]);
    }
  }

  const chartData: ChartDataPoint[] = data.snapshots.map((s) => ({
    date: s.date,
    netLiquidation: s.netLiquidation,
    fundFlows: fundFlowsByDate.get(s.date) || [],
  }));

  // Collect all fund flow markers for ReferenceDots
  const fundFlowMarkers: Array<{ date: string; netLiquidation: number; flow: FundFlowPoint; idx: number }> = [];
  for (const d of chartData) {
    for (let i = 0; i < d.fundFlows.length; i++) {
      fundFlowMarkers.push({ date: d.date, netLiquidation: d.netLiquidation, flow: d.fundFlows[i], idx: i });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Account Value</CardTitle>
        <ToggleGroup
          type="single"
          value={range}
          onValueChange={(v) => v && setRange(v as TimeRange)}
          size="sm"
        >
          <ToggleGroupItem value="1Y">1Y</ToggleGroupItem>
          <ToggleGroupItem value="3Y">3Y</ToggleGroupItem>
          <ToggleGroupItem value="5Y">5Y</ToggleGroupItem>
          <ToggleGroupItem value="ALL">All</ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              width={60}
            />
            <Tooltip content={<NlvTooltip />} />
            <Line
              type="linear"
              dataKey="netLiquidation"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
            />
            {fundFlowMarkers.map((m) => (
              <ReferenceDot
                key={`${m.date}-${m.idx}`}
                x={m.date}
                y={m.netLiquidation}
                r={5}
                fill={m.flow.amount >= 0 ? "#16a34a" : "#dc2626"}
                stroke="white"
                strokeWidth={2}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
