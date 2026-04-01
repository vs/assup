import { useState } from "react";
import type { MarketScannerPreset, ScanCodeInfo, TechnicalFilterConfig } from "@assup/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Save, X } from "lucide-react";

const LOCATION_CODES = [
  { value: "STK.US.MAJOR", label: "US Major (NYSE + NASDAQ)" },
  { value: "STK.US", label: "US All" },
  { value: "STK.NYSE", label: "NYSE" },
  { value: "STK.NASDAQ", label: "NASDAQ" },
  { value: "STK.AMEX", label: "AMEX" },
];

const STOCK_TYPES = [
  { value: "", label: "All" },
  { value: "CORP", label: "Corporation" },
  { value: "ADR", label: "ADR" },
  { value: "ETF", label: "ETF" },
  { value: "REIT", label: "REIT" },
];

interface ScannerPresetEditorProps {
  preset?: MarketScannerPreset;
  scanCodes: ScanCodeInfo[];
  onSave: (preset: MarketScannerPreset) => void;
  onCancel: () => void;
}

export function ScannerPresetEditor({
  preset,
  scanCodes,
  onSave,
  onCancel,
}: ScannerPresetEditorProps) {
  const isEdit = !!preset;
  const filters = (preset?.filters ?? {}) as Record<string, unknown>;

  const [name, setName] = useState(preset?.name ?? "");
  const [scanCode, setScanCode] = useState(preset?.scanCode ?? "");
  const [locationCode, setLocationCode] = useState(preset?.locationCode ?? "STK.US.MAJOR");
  const [minPrice, setMinPrice] = useState<string>(String(filters.abovePrice ?? ""));
  const [maxPrice, setMaxPrice] = useState<string>(String(filters.belowPrice ?? ""));
  const [minVolume, setMinVolume] = useState<string>(String(filters.aboveVolume ?? ""));
  const [minMarketCap, setMinMarketCap] = useState<string>(String(filters.marketCapAbove ?? ""));
  const [maxMarketCap, setMaxMarketCap] = useState<string>(String(filters.marketCapBelow ?? ""));
  const [stockType, setStockType] = useState<string>(String(filters.stockTypeFilter ?? ""));

  const existingTech = preset?.technicalFilter ?? {
    enabled: false,
    maxRsi: 40,
    requireAboveSma200: true,
    trendPeriodYears: 3,
    minSma200SlopeMonths: 6,
    require50Above200: false,
  };
  const [techEnabled, setTechEnabled] = useState(existingTech.enabled);
  const [maxRsi, setMaxRsi] = useState<string>(String(existingTech.maxRsi ?? 40));
  const [requireAboveSma200, setRequireAboveSma200] = useState(existingTech.requireAboveSma200 ?? true);
  const [trendPeriodYears, setTrendPeriodYears] = useState<string>(String(existingTech.trendPeriodYears ?? 3));
  const [sma200SlopeMonths, setSma200SlopeMonths] = useState<string>(String(existingTech.minSma200SlopeMonths ?? 6));
  const [require50Above200, setRequire50Above200] = useState(existingTech.require50Above200 ?? false);

  const [schedule, setSchedule] = useState(preset?.schedule ?? "");
  const [enabled, setEnabled] = useState(preset?.enabled ?? true);
  const [techOpen, setTechOpen] = useState(techEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!scanCode) {
      setError("Scan code is required");
      return;
    }

    setSaving(true);
    setError(null);

    const builtFilters: Record<string, unknown> = {};
    if (minPrice) builtFilters.abovePrice = Number(minPrice);
    if (maxPrice) builtFilters.belowPrice = Number(maxPrice);
    if (minVolume) builtFilters.aboveVolume = Number(minVolume);
    if (minMarketCap) builtFilters.marketCapAbove = Number(minMarketCap);
    if (maxMarketCap) builtFilters.marketCapBelow = Number(maxMarketCap);
    if (stockType) builtFilters.stockTypeFilter = stockType;

    const technicalFilter: TechnicalFilterConfig = {
      enabled: techEnabled,
      maxRsi: techEnabled ? Number(maxRsi) : undefined,
      requireAboveSma200: techEnabled ? requireAboveSma200 : undefined,
      trendPeriodYears: techEnabled ? Number(trendPeriodYears) : undefined,
      minSma200SlopeMonths: techEnabled ? Number(sma200SlopeMonths) : undefined,
      require50Above200: techEnabled ? require50Above200 : undefined,
    };

    const result: MarketScannerPreset = {
      id: preset?.id ?? "",
      name: name.trim(),
      scanCode,
      locationCode,
      filters: builtFilters,
      technicalFilter,
      schedule,
      enabled,
      lastRun: preset?.lastRun ?? null,
    };

    onSave(result);
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">
        {isEdit ? "Edit Preset" : "New Preset"}
      </div>

      {error && (
        <div className="p-2 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="preset-name">Name</Label>
        <Input
          id="preset-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Value Stocks Under $50"
        />
      </div>

      {/* Scan Code + Location */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Scan Code</Label>
          <Select value={scanCode} onValueChange={setScanCode}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select scan type..." />
            </SelectTrigger>
            <SelectContent>
              {scanCodes.map((sc) => (
                <SelectItem key={sc.code} value={sc.code}>
                  {sc.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Location</Label>
          <Select value={locationCode} onValueChange={setLocationCode}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCATION_CODES.map((loc) => (
                <SelectItem key={loc.value} value={loc.value}>
                  {loc.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Filters</Label>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Min Price</label>
            <Input
              type="number"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="0"
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Max Price</label>
            <Input
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="500"
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Min Volume</label>
            <Input
              type="number"
              value={minVolume}
              onChange={(e) => setMinVolume(e.target.value)}
              placeholder="100000"
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Stock Type</label>
            <Select value={stockType || "__all__"} onValueChange={(v) => setStockType(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-full h-8">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                {STOCK_TYPES.map((st) => (
                  <SelectItem key={st.value || "__all__"} value={st.value || "__all__"}>
                    {st.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Min Market Cap</label>
            <Input
              type="number"
              value={minMarketCap}
              onChange={(e) => setMinMarketCap(e.target.value)}
              placeholder="e.g. 2000000000"
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Max Market Cap</label>
            <Input
              type="number"
              value={maxMarketCap}
              onChange={(e) => setMaxMarketCap(e.target.value)}
              placeholder=""
              className="h-8"
            />
          </div>
        </div>
      </div>

      {/* Technical Filter (collapsible) */}
      <Collapsible open={techOpen} onOpenChange={setTechOpen}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1.5 text-sm font-medium hover:text-foreground text-muted-foreground">
              {techOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Technical Filter
            </button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-2">
            <Label htmlFor="tech-enabled" className="text-xs text-muted-foreground">
              {techEnabled ? "Enabled" : "Disabled"}
            </Label>
            <Switch
              id="tech-enabled"
              checked={techEnabled}
              onCheckedChange={setTechEnabled}
            />
          </div>
        </div>
        <CollapsibleContent>
          <div className="mt-3 space-y-3 pl-5 border-l-2 border-muted">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Max RSI</label>
                <Input
                  type="number"
                  value={maxRsi}
                  onChange={(e) => setMaxRsi(e.target.value)}
                  disabled={!techEnabled}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Trend Period (years)</label>
                <Input
                  type="number"
                  value={trendPeriodYears}
                  onChange={(e) => setTrendPeriodYears(e.target.value)}
                  disabled={!techEnabled}
                  className="h-8"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">SMA200 Slope Period (months)</label>
                <Input
                  type="number"
                  value={sma200SlopeMonths}
                  onChange={(e) => setSma200SlopeMonths(e.target.value)}
                  disabled={!techEnabled}
                  className="h-8"
                />
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="require-above-sma200"
                  checked={requireAboveSma200}
                  onCheckedChange={setRequireAboveSma200}
                  disabled={!techEnabled}
                />
                <Label htmlFor="require-above-sma200" className="text-sm">
                  Require above SMA200
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="require-golden-cross"
                  checked={require50Above200}
                  onCheckedChange={setRequire50Above200}
                  disabled={!techEnabled}
                />
                <Label htmlFor="require-golden-cross" className="text-sm">
                  Require golden cross
                </Label>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Schedule + Enabled */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="schedule">Schedule (cron)</Label>
          <Input
            id="schedule"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="e.g. 0 6 * * 1-5"
            className="h-8"
          />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <Switch
            id="preset-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <Label htmlFor="preset-enabled" className="text-sm">
            Enabled
          </Label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          <X className="h-4 w-4 mr-1" />
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" />
          {isEdit ? "Update" : "Create"} Preset
        </Button>
      </div>
    </div>
  );
}
