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
  isNew?: boolean;
  onChange: (config: WheelScanConfig) => void;
  onDelete: (id: string) => void;
}

export function ConfigEditor({
  config,
  assetClasses,
  isNew,
  onChange,
  onDelete,
}: ConfigEditorProps) {
  const [tickerInput, setTickerInput] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (updated: Partial<WheelScanConfig>) => {
      const merged = { ...config, ...updated };
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
        onChange(saved);
      } catch (err) {
        console.error("Failed to save config:", err);
      } finally {
        setSaving(false);
      }
    },
    [config, onChange]
  );

  function addTicker(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
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

  function addKeyword(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const val = keywordInput.trim();
    if (!val || config.searchKeywords.includes(val)) {
      setKeywordInput("");
      return;
    }
    const updated = [...config.searchKeywords, val];
    setKeywordInput("");
    save({ searchKeywords: updated });
  }

  function removeKeyword(kw: string) {
    save({ searchKeywords: config.searchKeywords.filter((k) => k !== kw) });
  }

  const assetClass = assetClasses.find((ac) => ac.id === config.assetClassId);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isNew ? (
            <Select
              value={config.assetClassId}
              onValueChange={(id) => save({ assetClassId: id })}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select asset class..." />
              </SelectTrigger>
              <SelectContent>
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
          onClick={() => onDelete(config.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Seed Tickers */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">
          Seed Tickers
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

      {/* Search Keywords */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">
          Search Keywords
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {config.searchKeywords.map((kw) => (
            <Badge key={kw} variant="outline" className="gap-1 pr-1">
              {kw}
              <button
                onClick={() => removeKeyword(kw)}
                className="ml-0.5 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Input
            className="h-7 w-32 text-sm"
            placeholder="Add..."
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={addKeyword}
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
            value={config.minPrice}
            onChange={(e) => save({ minPrice: Number(e.target.value) })}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="number"
            className="h-7 w-20 text-sm"
            value={config.maxPrice}
            onChange={(e) => save({ maxPrice: Number(e.target.value) })}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Min Mkt Cap:</span>
          <Input
            type="number"
            className="h-7 w-28 text-sm"
            value={config.minMarketCap / 1e9}
            onChange={(e) =>
              save({ minMarketCap: Number(e.target.value) * 1e9 })
            }
          />
          <span className="text-muted-foreground text-xs">B</span>
        </div>
      </div>
    </div>
  );
}
