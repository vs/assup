import type { DashboardPeriod } from "@assup/shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PeriodSelectorProps {
  period: DashboardPeriod;
  year: number;
  availableYears: number[];
  onPeriodChange: (period: DashboardPeriod) => void;
  onYearChange: (year: number) => void;
}

export function PeriodSelector({ period, year, availableYears, onPeriodChange, onYearChange }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-3">
      <ToggleGroup type="single" value={period} onValueChange={(v) => v && onPeriodChange(v as DashboardPeriod)}>
        <ToggleGroupItem value="mtd" className="text-xs px-3">MTD</ToggleGroupItem>
        <ToggleGroupItem value="ytd" className="text-xs px-3">YTD</ToggleGroupItem>
        <ToggleGroupItem value="year" className="text-xs px-3">Year</ToggleGroupItem>
        <ToggleGroupItem value="all" className="text-xs px-3">All Time</ToggleGroupItem>
      </ToggleGroup>
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
