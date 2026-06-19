import { LineChart, Line, ResponsiveContainer } from "recharts";

interface PnlSparklineProps {
  data: number[];
  width?: number;
  height?: number;
}

export function PnlSparkline({ data, width = 120, height = 24 }: PnlSparklineProps) {
  if (data.length === 0) return <span className="text-muted-foreground">--</span>;

  const total = data.reduce((sum, v) => sum + v, 0);
  const color = total >= 0 ? "#22c55e" : "#ef4444";
  const chartData = data.map((value, i) => ({ i, value }));

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
