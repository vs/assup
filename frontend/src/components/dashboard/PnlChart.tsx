import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ChartDataPoint, formatCurrency } from "@assup/shared";
import { Card, CardContent } from "@/components/ui/card";

interface PnlChartProps {
  data: ChartDataPoint[];
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ChartDataPoint;
  return (
    <div className="bg-popover border rounded-md p-3 text-sm shadow-md">
      <div className="font-medium mb-1">{label}</div>
      <div className="space-y-0.5 text-xs">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Options</span>
          <span className={d.options >= 0 ? "text-green-500" : "text-red-500"}>{formatCurrency(d.options)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Spreads</span>
          <span className={d.spreads >= 0 ? "text-green-500" : "text-red-500"}>{formatCurrency(d.spreads)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Stocks</span>
          <span className={d.stocks >= 0 ? "text-green-500" : "text-red-500"}>{formatCurrency(d.stocks)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Div & Interest</span>
          <span className={d.dividendsInterest >= 0 ? "text-green-500" : "text-red-500"}>{formatCurrency(d.dividendsInterest)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Fees</span>
          <span className="text-red-500">{formatCurrency(d.fees)}</span>
        </div>
        <div className="flex justify-between gap-4 border-t pt-1 mt-1 font-medium">
          <span>Total</span>
          <span className={d.total >= 0 ? "text-green-500" : "text-red-500"}>{formatCurrency(d.total)}</span>
        </div>
      </div>
    </div>
  );
}

export function PnlChart({ data }: PnlChartProps) {
  if (data.length === 0) return null;

  const lastPoint = data[data.length - 1];
  const isPositive = lastPoint.cumulative >= 0;
  const strokeColor = isPositive ? "#22c55e" : "#ef4444";
  const fillColor = isPositive ? "#22c55e" : "#ef4444";

  return (
    <Card>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={250}>
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
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
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
      </CardContent>
    </Card>
  );
}
