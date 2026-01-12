import { LineChart, Line, ResponsiveContainer } from "recharts";
import type { SparklinePoint } from "@assup/shared";

interface SparklineProps {
  data: SparklinePoint[];
  width?: number;
  height?: number;
  loading?: boolean;
  error?: boolean;
}

export function Sparkline({
  data,
  width = 80,
  height = 30,
  loading = false,
  error = false,
}: SparklineProps) {
  if (loading) {
    return (
      <div
        className="bg-muted animate-pulse rounded"
        style={{ width, height }}
      />
    );
  }

  if (error || !data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-xs"
        style={{ width, height }}
      >
        --
      </div>
    );
  }

  const firstPrice = data[0]?.close ?? 0;
  const lastPrice = data[data.length - 1]?.close ?? 0;
  const isPositive = lastPrice >= firstPrice;
  const strokeColor = isPositive ? "#22c55e" : "#ef4444";

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="close"
            stroke={strokeColor}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
