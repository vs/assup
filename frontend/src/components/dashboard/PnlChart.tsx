import { useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import type { ChartDataPoint, DashboardSummary } from "@assup/shared";
import { formatCurrency } from "@assup/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type ChartMode = "cumulative" | "monthly";

interface PnlChartProps {
  data: ChartDataPoint[];
  periodTotal?: DashboardSummary["periodTotal"];
  periodIncludesCurrentMonth?: boolean;
}

function CustomTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ChartDataPoint;
  return (
    <div className="bg-popover border rounded-md p-3 text-sm shadow-md">
      <div className="font-medium mb-1">{label}</div>
      <div className="space-y-0.5 text-xs">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Options</span>
          <span className={d.options >= 0 ? "text-green-600" : "text-red-600"}>{formatCurrency(d.options)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Spreads</span>
          <span className={d.spreads >= 0 ? "text-green-600" : "text-red-600"}>{formatCurrency(d.spreads)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Stocks</span>
          <span className={d.stocks >= 0 ? "text-green-600" : "text-red-600"}>{formatCurrency(d.stocks)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Div &amp; Interest</span>
          <span className={d.dividendsInterest >= 0 ? "text-green-600" : "text-red-600"}>{formatCurrency(d.dividendsInterest)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Fees</span>
          <span className="text-red-600">{formatCurrency(d.fees)}</span>
        </div>
        <div className="flex justify-between gap-4 border-t pt-1 mt-1 font-medium">
          <span>Realized</span>
          <span className={d.total >= 0 ? "text-green-600" : "text-red-600"}>{formatCurrency(d.total)}</span>
        </div>
        {d.projected ? (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Projected</span>
              <span className="text-blue-600">{formatCurrency(d.projected)}</span>
            </div>
            <div className="flex justify-between gap-4 font-medium">
              <span>Est. Total</span>
              <span className={(d.total + d.projected) >= 0 ? "text-green-600" : "text-red-600"}>
                {formatCurrency(d.total + d.projected)}
              </span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function PnlChart({ data, periodTotal, periodIncludesCurrentMonth }: PnlChartProps) {
  const [mode, setMode] = useState<ChartMode>("monthly");

  if (data.length === 0) return null;

  const lastPoint = data[data.length - 1];
  const isPositive = lastPoint.cumulative >= 0;
  const strokeColor = isPositive ? "#22c55e" : "#ef4444";
  const fillColor = isPositive ? "#22c55e" : "#ef4444";

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-0 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div>
            {periodTotal && (
              <>
                <CardTitle className={`text-2xl font-bold tabular-nums ${periodTotal.total >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {formatCurrency(periodTotal.total)}
                </CardTitle>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Realized {formatCurrency(periodTotal.realized)}
                  {periodIncludesCurrentMonth && periodTotal.unrealized !== null && (
                    <> · Unrealized {formatCurrency(periodTotal.unrealized)}</>
                  )}
                  {periodIncludesCurrentMonth && periodTotal.projected !== null && (
                    <> · Projected {formatCurrency(periodTotal.projected)}</>
                  )}
                </div>
              </>
            )}
          </div>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as ChartMode)}
          >
            <ToggleGroupItem value="cumulative" className="text-xs px-3 h-7">
              Cumulative
            </ToggleGroupItem>
            <ToggleGroupItem value="monthly" className="text-xs px-3 h-7">
              Monthly
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2 flex-1 min-h-0">
        {mode === "cumulative" ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={fillColor} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={fillColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="period"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => {
                  const k = v / 1000;
                  return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="cumulative"
                stroke={strokeColor}
                strokeWidth={2}
                fill="url(#pnlGradient)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} stackOffset="sign">
              <XAxis
                dataKey="period"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => {
                  const k = v / 1000;
                  return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="total" stackId="pnl" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.total >= 0 ? "#22c55e" : "#ef4444"}
                  />
                ))}
              </Bar>
              <Bar dataKey="projected" stackId="pnl" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-proj-${index}`}
                    fill="#2563eb"
                    fillOpacity={entry.projected ? 0.5 : 0}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
