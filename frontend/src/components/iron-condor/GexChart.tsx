import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GexStrikeData, GexKeyLevels } from "@assup/shared";

interface GexChartProps {
  strikes: GexStrikeData[];
  spot: number;
  levels: GexKeyLevels;
}

function formatGEX(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(0);
}

function GexTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as GexStrikeData;
  return (
    <div className="bg-popover border rounded-md p-3 text-sm shadow-md">
      <div className="font-medium mb-1">Strike: {d.strike}</div>
      <div className="space-y-0.5 text-xs">
        <div>Net GEX: <span className={d.netGEX >= 0 ? "text-green-500" : "text-red-500"}>{formatGEX(d.netGEX)}</span></div>
        <div>Call GEX: <span className="text-green-500">{formatGEX(d.callGEX)}</span></div>
        <div>Put GEX: <span className="text-red-500">{formatGEX(d.putGEX)}</span></div>
        <div className="border-t pt-1 mt-1">Call OI: {d.callOI.toLocaleString()} · Put OI: {d.putOI.toLocaleString()}</div>
      </div>
    </div>
  );
}

export function GexChart({ strikes, spot, levels }: GexChartProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">GEX by Strike</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={strikes} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis
                dataKey="strike"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatGEX}
                width={55}
              />
              <Tooltip content={<GexTooltip />} />
              <ReferenceLine x={spot} stroke="var(--foreground)" strokeDasharray="3 3" strokeWidth={1.5} label={{ value: `Spot ${spot}`, position: "top", fontSize: 10 }} />
              {levels.gexFlip != null && (
                <ReferenceLine x={levels.gexFlip} stroke="#eab308" strokeDasharray="5 5" strokeWidth={1} label={{ value: "GEX Flip", position: "top", fontSize: 9, fill: "#eab308" }} />
              )}
              <Bar dataKey="netGEX" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {strikes.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.netGEX >= 0 ? "#22c55e" : "#ef4444"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
