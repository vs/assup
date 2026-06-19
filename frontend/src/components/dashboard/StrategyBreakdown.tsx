import { DashboardSummary } from "@assup/shared";
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
    <div className="space-y-2">
      {STRATEGY_CONFIG.map(({ key, name, color }) => (
        <StrategyRow key={key} name={name} color={color} metrics={strategies[key]} />
      ))}
    </div>
  );
}
