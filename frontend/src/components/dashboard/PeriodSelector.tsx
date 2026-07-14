import type { DashboardPeriod } from "@assup/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PeriodSelectorProps {
  period: DashboardPeriod;
  year: number;
  availableYears: number[];
  onPeriodChange: (period: DashboardPeriod) => void;
  onYearChange: (year: number) => void;
}

const periods: { value: DashboardPeriod; label: string }[] = [
  { value: "mtd", label: "MTD" },
  { value: "ytd", label: "YTD" },
  { value: "year", label: "Year" },
  { value: "all", label: "All Time" },
];

export function PeriodSelector({ period, year, availableYears, onPeriodChange, onYearChange }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex rounded-md border overflow-hidden">
        {periods.map((p) => (
          <button
            key={p.value}
            onClick={() => onPeriodChange(p.value)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              period === p.value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {period === "year" && (
        <Select value={String(year)} onValueChange={(v) => onYearChange(parseInt(v, 10))}>
          <SelectTrigger className="w-24 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableYears.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
