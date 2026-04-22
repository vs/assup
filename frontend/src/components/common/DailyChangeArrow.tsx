import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export function DailyChangeArrow({ change }: { change: number }) {
  const threshold = 0.05;
  if (Math.abs(change) < threshold) {
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  if (change > 0) {
    return (
      <span className="inline-flex items-center text-green-600">
        <TrendingUp className="h-3.5 w-3.5" />
        <span className="text-xs font-medium ml-0.5">
          +{change.toFixed(1)}%
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-red-600">
      <TrendingDown className="h-3.5 w-3.5" />
      <span className="text-xs font-medium ml-0.5">{change.toFixed(1)}%</span>
    </span>
  );
}
