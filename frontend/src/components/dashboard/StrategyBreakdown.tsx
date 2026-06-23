import type { DashboardSummary } from "@assup/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StrategyRow } from "./StrategyRow";

interface StrategyBreakdownProps {
  strategies: DashboardSummary["strategies"];
}

const STRATEGY_CONFIG = [
  { key: "options" as const, name: "Options", color: "#8b5cf6" },
  { key: "spreads" as const, name: "Spreads", color: "#3b82f6" },
  { key: "stocks" as const, name: "Stocks", color: "#f59e0b" },
  { key: "dividendsInterest" as const, name: "Div & Interest", color: "#22c55e" },
  { key: "fees" as const, name: "Fees", color: "#6b7280" },
];

export function StrategyBreakdown({ strategies }: StrategyBreakdownProps) {
  return (
    <Card className="flex-1">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold">Strategy Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-1">
        {STRATEGY_CONFIG.map(({ key, name, color }) => (
          <StrategyRow key={key} name={name} color={color} metrics={strategies[key]} />
        ))}
      </CardContent>
    </Card>
  );
}
