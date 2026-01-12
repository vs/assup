import type { AssetClass } from "@assup/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X, RefreshCw } from "lucide-react";

export interface FilterState {
  assetClassId: string | null;
  includeOptions: boolean;
  optionsWeightMode: "notional" | "delta";
}

export const DEFAULT_FILTERS: FilterState = {
  assetClassId: null,
  includeOptions: true,
  optionsWeightMode: "notional",
};

interface PositionFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  assetClasses: AssetClass[];
  optionsCount: number;
  loading: boolean;
  onRefresh: () => void;
}

export function PositionFilters({
  filters,
  onFiltersChange,
  assetClasses,
  optionsCount,
  loading,
  onRefresh,
}: PositionFiltersProps) {
  const hasActiveFilters = filters.assetClassId || !filters.includeOptions;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Select
        value={filters.assetClassId || "all"}
        onValueChange={(v) => onFiltersChange({ ...filters, assetClassId: v === "all" ? null : v })}
      >
        <SelectTrigger className="w-48 h-8">
          <SelectValue placeholder="All classes" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All classes</SelectItem>
          <SelectItem value="unassigned">Unassigned only</SelectItem>
          {assetClasses.map((ac) => (
            <SelectItem key={ac.id} value={ac.id}>
              <div className="flex items-center gap-2">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: ac.color }}
                />
                {ac.name}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Switch
          id="include-options"
          checked={filters.includeOptions}
          onCheckedChange={(checked) => onFiltersChange({ ...filters, includeOptions: checked })}
        />
        <Label htmlFor="include-options" className="text-sm cursor-pointer">
          Include Options {optionsCount > 0 && `(${optionsCount})`}
        </Label>
      </div>

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={() => onFiltersChange({ ...DEFAULT_FILTERS })}
        >
          <X className="h-3 w-3 mr-1" />
          Clear
        </Button>
      )}

      <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </div>
  );
}
