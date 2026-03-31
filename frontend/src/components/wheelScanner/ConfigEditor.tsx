import { useState, useCallback } from "react";
import type { WheelScanConfig, AssetClass } from "@assup/shared";
import { wheelScannerApi } from "@/api/wheelScanner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Trash2 } from "lucide-react";

interface ConfigEditorProps {
  config: WheelScanConfig;
  assetClasses: AssetClass[];
  configuredAssetClassIds: Set<string>;
  isNew?: boolean;
  onChange: (config: WheelScanConfig) => void;
  onDelete: () => void;
}

export function ConfigEditor({
  config,
  assetClasses,
  configuredAssetClassIds,
  isNew,
  onChange,
  onDelete,
}: ConfigEditorProps) {
  const [tickerInput, setTickerInput] = useState("");
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (updated: Partial<WheelScanConfig>) => {
      const merged = { ...config, ...updated };
      if (!merged.assetClassId) return; // Can't save without asset class
      setSaving(true);
      try {
        const saved = await wheelScannerApi.configs.upsert({
          assetClassId: merged.assetClassId,
          searchKeywords: merged.searchKeywords,
          seedTickers: merged.seedTickers,
          minPrice: merged.minPrice,
          maxPrice: merged.maxPrice,
          minMarketCap: merged.minMarketCap,
          enabled: merged.enabled,
        });
        // Preserve assetClass relation from local state (backend upsert doesn't include it)
        const ac = assetClasses.find((a) => a.id === saved.assetClassId);
        const enriched: WheelScanConfig = {
          ...saved,
          assetClass: ac ? { id: ac.id, name: ac.name, color: ac.color } : config.assetClass,
        };
        onChange(enriched);
      } catch (err) {
        console.error("Failed to save config:", err);
      } finally {
        setSaving(false);
      }
    },
    [config, assetClasses, onChange]
  );

  function addTicker(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const val = tickerInput.trim().toUpperCase();
    if (!val || config.seedTickers.includes(val)) {
      setTickerInput("");
      return;
    }
    const updated = [...config.seedTickers, val];
    setTickerInput("");
    save({ seedTickers: updated });
  }

  function removeTicker(ticker: string) {
    save({ seedTickers: config.seedTickers.filter((t) => t !== ticker) });
  }

  const assetClass = assetClasses.find((ac) => ac.id === config.assetClassId);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isNew ? (
            <Select
              value={config.assetClassId || undefined}
              onValueChange={(id) => {
                const ac = assetClasses.find((a) => a.id === id);
                onChange({
                  ...config,
                  assetClassId: id,
                  assetClass: ac ? { id: ac.id, name: ac.name, color: ac.color } : undefined,
                });
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select asset class..." />
              </SelectTrigger>
              <SelectContent>
                {assetClasses
                  .filter((ac) => !configuredAssetClassIds.has(ac.id) || ac.id === config.assetClassId)
                  .map((ac) => (
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
          ) : (
            <div className="flex items-center gap-2">
              {assetClass && (
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: assetClass.color }}
                />
              )}
              <span className="font-medium">
                {assetClass?.name ?? config.assetClassId}
              </span>
            </div>
          )}
          {saving && (
            <span className="text-xs text-muted-foreground animate-pulse">
              Saving...
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Tickers */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">
          Tickers
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {config.seedTickers.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1 pr-1">
              {t}
              <button
                onClick={() => removeTicker(t)}
                className="ml-0.5 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Input
            className="h-7 w-24 text-sm"
            placeholder="Add..."
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            onKeyDown={addTicker}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Price:</span>
          <Input
            type="number"
            className="h-7 w-20 text-sm"
            defaultValue={config.minPrice}
            onBlur={(e) => save({ minPrice: Number(e.target.value) })}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="number"
            className="h-7 w-20 text-sm"
            defaultValue={config.maxPrice}
            onBlur={(e) => save({ maxPrice: Number(e.target.value) })}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Min Mkt Cap:</span>
          <Input
            type="number"
            className="h-7 w-28 text-sm"
            defaultValue={config.minMarketCap / 1e9}
            onBlur={(e) =>
              save({ minMarketCap: Number(e.target.value) * 1e9 })
            }
          />
          <span className="text-muted-foreground text-xs">B</span>
        </div>
      </div>
    </div>
  );
}
