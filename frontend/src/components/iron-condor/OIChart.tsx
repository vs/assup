import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GexStrikeData } from "@assup/shared";

interface OIChartProps {
  strikes: GexStrikeData[];
  spot: number;
}

function formatOI(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function OITooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as GexStrikeData;
  return (
    <div className="bg-popover border rounded-md p-3 text-sm shadow-md">
      <div className="font-medium mb-1">Strike: {d.strike}</div>
      <div className="space-y-0.5 text-xs">
        <div>Put OI: <span className="text-red-500">{d.putOI.toLocaleString()}</span></div>
        <div>Call OI: <span className="text-blue-500">{d.callOI.toLocaleString()}</span></div>
        <div>Put Volume: {d.putVolume.toLocaleString()}</div>
        <div>Call Volume: {d.callVolume.toLocaleString()}</div>
      </div>
    </div>
  );
}

export function OIChart({ strikes, spot }: OIChartProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Open Interest Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[320px]">
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
                tickFormatter={formatOI}
                width={50}
              />
              <Tooltip content={<OITooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine x={spot} stroke="var(--foreground)" strokeDasharray="3 3" strokeWidth={1.5} />
              <Bar dataKey="putOI" name="Put OI" fill="#ef4444" fillOpacity={0.7} isAnimationActive={false} radius={[2, 2, 0, 0]} />
              <Bar dataKey="callOI" name="Call OI" fill="#3b82f6" fillOpacity={0.7} isAnimationActive={false} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
