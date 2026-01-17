import { LineChart, Line, YAxis } from "recharts";
import type { SparklinePoint } from "@assup/shared";

interface SparklineProps {
  data: SparklinePoint[];
  width?: number;
  height?: number;
  loading?: boolean;
  error?: boolean;
  onChartClick?: () => void;
}

export function Sparkline({
  data,
  width = 80,
  height = 30,
  loading = false,
  error = false,
  onChartClick,
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

  // Calculate domain with padding so data fills 80% of vertical space (10% to 90%)
  const prices = data.map((d) => d.close);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice;
  // Add 12.5% padding on each side (so data spans 80% of chart)
  const padding = range > 0 ? range * 0.125 : Math.abs(minPrice) * 0.1 || 1;
  const domain: [number, number] = [minPrice - padding, maxPrice + padding];

  const chart = (
    <LineChart width={width} height={height} data={data}>
      <YAxis domain={domain} hide />
      <Line
        type="monotone"
        dataKey="close"
        stroke={strokeColor}
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );

  if (onChartClick) {
    return (
      <button
        type="button"
        onClick={onChartClick}
        className="block hover:opacity-80 transition-opacity cursor-pointer"
      >
        {chart}
      </button>
    );
  }

  return chart;
}
