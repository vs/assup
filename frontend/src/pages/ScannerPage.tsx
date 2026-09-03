import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api";
import type { ScannerCriteria, ScannerPreset, AssetClass, OptionTypeFilter } from "@assup/shared";
import { cn } from "@/lib/utils";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { useTickerProfileContext } from "@/components/common/TickerProfileProvider";
import { SellOptionDialog, ScanJobList } from "@/components/scanner";
import type { TickerCostBasis } from "@/components/scanner/GroupedResultsTable";
import { useScanJobs } from "@/hooks";
import type { ExtendedOptionOpportunity } from "@/components/scanner/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Search, Save, X, Check, ChevronsUpDown } from "lucide-react";

const PUT_DEFAULTS: ScannerCriteria = {
  optionTypes: "PUT",
  minDaysToExpiry: 3,
  maxDaysToExpiry: 45,
  minDelta: 0,
  maxDelta: 0.35,
  minAnnualizedReturn: 5,
  minPremiumPercent: 0.2,
  putMinStrikePercent: 70,
  putMaxStrikePercent: 100,
  callMinStrikePercent: 100,
  callMaxStrikePercent: 125,
};

const CALL_DEFAULTS: ScannerCriteria = {
  optionTypes: "CALL",
  minDaysToExpiry: 3,
  maxDaysToExpiry: 45,
  minDelta: 0,
  maxDelta: 0.35,
  minAnnualizedReturn: 5,
  minPremiumPercent: 0.2,
  putMinStrikePercent: 100,
  putMaxStrikePercent: 70,
  callMinStrikePercent: 100,
  callMaxStrikePercent: 130,
};

const STRATEGY_DEFAULTS: Record<OptionTypeFilter, ScannerCriteria> = {
  PUT: PUT_DEFAULTS,
  CALL: CALL_DEFAULTS,
};

const DEFAULT_CRITERIA = PUT_DEFAULTS;

/**
 * Normalize preset criteria to handle legacy field names and missing fields
 */
function normalizePresetCriteria(criteria: ScannerCriteria): ScannerCriteria {
  // Handle legacy field names (minStrikePercent -> putMinStrikePercent, etc.)
  const legacyCriteria = criteria as ScannerCriteria & {
    minStrikePercent?: number;
    maxStrikePercent?: number;
  };
  return {
    ...DEFAULT_CRITERIA,
    ...legacyCriteria,
    // Map legacy strike fields to PUT fields if new fields are missing
    putMinStrikePercent: legacyCriteria.putMinStrikePercent ?? legacyCriteria.minStrikePercent ?? DEFAULT_CRITERIA.putMinStrikePercent,
    putMaxStrikePercent: legacyCriteria.putMaxStrikePercent ?? legacyCriteria.maxStrikePercent ?? DEFAULT_CRITERIA.putMaxStrikePercent,
    callMinStrikePercent: legacyCriteria.callMinStrikePercent ?? DEFAULT_CRITERIA.callMinStrikePercent,
    callMaxStrikePercent: legacyCriteria.callMaxStrikePercent ?? DEFAULT_CRITERIA.callMaxStrikePercent,
    // Ensure optionTypes has a value
    optionTypes: legacyCriteria.optionTypes ?? DEFAULT_CRITERIA.optionTypes,
  };
}

export function ScannerPage() {
  const [searchParams] = useSearchParams();
  const [criteria, setCriteria] = useState<ScannerCriteria>(() => {
    const optionType = searchParams.get("optionType") as OptionTypeFilter | null;
    const base = optionType && STRATEGY_DEFAULTS[optionType] ? STRATEGY_DEFAULTS[optionType] : DEFAULT_CRITERIA;
    const symbol = searchParams.get("symbol");
    if (symbol) {
      return { ...base, specificSymbol: symbol.toUpperCase() };
    }
    const assetClassId = searchParams.get("assetClassId");
    if (assetClassId) {
      return { ...base, targetAssetClasses: [assetClassId] };
    }
    return base;
  });
  const [presets, setPresets] = useState<ScannerPreset[]>([]);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [symbolComboboxOpen, setSymbolComboboxOpen] = useState(false);
  const [sellDialogOpen, setSellDialogOpen] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState<ExtendedOptionOpportunity | null>(null);
  const [costBasisMap, setCostBasisMap] = useState<Map<string, TickerCostBasis>>(new Map());

  const {
    jobs,
    createJob,
    cancelJob,
    deleteJob,
  } = useScanJobs();

  const { prefetch } = useTickerProfileContext();

  // Collect unique symbols from all job opportunities for prefetch
  const jobSymbols = useMemo(() => {
    const symbols = new Set<string>();
    for (const job of jobs) {
      if (job.opportunities) {
        for (const opp of job.opportunities) {
          symbols.add(opp.symbol);
        }
      }
    }
    return [...symbols];
  }, [jobs]);

  useEffect(() => {
    if (jobSymbols.length > 0) {
      prefetch(jobSymbols);
    }
  }, [jobSymbols, prefetch]);

  function handleSellClick(opportunity: ExtendedOptionOpportunity) {
    setSelectedOpportunity(opportunity);
    setSellDialogOpen(true);
  }

  useEffect(() => {
    loadEssentials();
    loadAuxiliary();
  }, []);

  async function loadEssentials() {
    try {
      setLoading(true);
      const [presetsData, acData] = await Promise.all([
        api.scanner.presets.list(),
        api.assetClasses.list(),
      ]);
      setPresets(presetsData);
      setAssetClasses(acData);

      const defaultPreset = presetsData.find((p) => p.isDefault);
      if (defaultPreset) {
        setCriteria((prev) => ({
          ...normalizePresetCriteria(defaultPreset.criteria),
          targetAssetClasses: prev.targetAssetClasses,
        }));
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function loadAuxiliary() {
    const [positionsResult, watchlistsResult, wheelResult] = await Promise.allSettled([
      api.positions.list(),
      api.watchlists.list(),
      api.wheel.list(),
    ]);

    const positionsData = positionsResult.status === "fulfilled" ? positionsResult.value : [];
    const watchlistsData = watchlistsResult.status === "fulfilled" ? watchlistsResult.value : [];
    const wheelData = wheelResult.status === "fulfilled" ? wheelResult.value : { tickers: [] };

    const cbMap = new Map<string, TickerCostBasis>();
    for (const pos of positionsData) {
      if (pos.secType === "STK") {
        cbMap.set(pos.symbol, {
          shares: pos.position,
          avgCost: pos.avgCost > 0 ? pos.avgCost : null,
          wheelCostBasis: null,
        });
      }
    }
    for (const wt of wheelData.tickers) {
      const existing = cbMap.get(wt.symbol);
      cbMap.set(wt.symbol, {
        shares: existing?.shares ?? (wt.shareQuantity || null),
        avgCost: existing?.avgCost ?? wt.positionAvgCost,
        wheelCostBasis: wt.adjustedCostBasis > 0 ? wt.adjustedCostBasis : null,
      });
    }
    setCostBasisMap(cbMap);

    const symbolsSet = new Set<string>();
    for (const pos of positionsData) {
      if (pos.secType === "STK") {
        symbolsSet.add(pos.symbol);
      }
    }

    const watchlistsWithItems = await Promise.all(
      watchlistsData.map((wl) => api.watchlists.get(wl.id).catch(() => null))
    );
    for (const wl of watchlistsWithItems) {
      if (!wl) continue;
      for (const item of wl.items) {
        if (item.secType === "STK") {
          symbolsSet.add(item.symbol);
        }
      }
    }

    setAvailableSymbols(Array.from(symbolsSet).sort());
  }

  function loadPreset(presetId: string) {
    const preset = presets.find((p) => p.id === presetId);
    if (preset) {
      setCriteria((prev) => ({
        ...normalizePresetCriteria(preset.criteria),
        // Preserve current symbol and asset class selections
        specificSymbol: prev.specificSymbol,
        targetAssetClasses: prev.targetAssetClasses,
      }));
    }
  }

  async function handleScan() {
    try {
      setError(null);

      // Get preset info if one is selected
      const selectedPreset = presets.find((p) =>
        JSON.stringify(p.criteria) === JSON.stringify(criteria)
      );

      await createJob({
        presetId: selectedPreset?.id,
        criteria,
      });

      // No longer need to set scanning/scanResult - job list handles it
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start scan");
    }
  }

  async function handleRescan(rescanCriteria: ScannerCriteria) {
    try {
      setError(null);
      await createJob({ criteria: rescanCriteria });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start rescan");
    }
  }

  async function handleClearCompleted() {
    const completedJobs = jobs.filter(
      (j) => j.status !== "running"
    );
    for (const job of completedJobs) {
      try {
        await deleteJob(job.id);
      } catch (err) {
        console.error("Failed to delete job:", err);
      }
    }
  }

  async function savePreset() {
    const name = prompt("Enter preset name:");
    if (!name) return;

    try {
      const preset = await api.scanner.presets.create({
        name,
        criteria,
        isDefault: false,
      });
      setPresets([...presets, preset]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preset");
    }
  }

  async function deletePreset(presetId: string) {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;

    if (!confirm(`Delete preset "${preset.name}"?`)) return;

    try {
      await api.scanner.presets.delete(presetId);
      setPresets(presets.filter((p) => p.id !== presetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete preset");
    }
  }

  if (loading) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Options Scanner</h1>
        <p className="text-muted-foreground">
          Find options opportunities for underinvested asset classes.
        </p>
      </div>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {/* Scanner Criteria */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Scanner Criteria</CardTitle>
          <div className="flex items-center gap-2">
            {presets.map((p) => (
              <Button
                key={p.id}
                variant="outline"
                size="sm"
                onClick={() => loadPreset(p.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  deletePreset(p.id);
                }}
                title="Click to load, right-click to delete"
              >
                {p.name}
              </Button>
            ))}
            <Button variant="outline" onClick={savePreset}>
              <Save className="h-4 w-4 mr-2" />
              Save Preset
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Option Strategy Toggle */}
          <div className="space-y-2">
            <Label>Option Strategy</Label>
            <ToggleGroup
              type="single"
              value={criteria.optionTypes}
              onValueChange={(value: string) => {
                if (value) {
                  const optionType = value as OptionTypeFilter;
                  setCriteria((prev) => ({
                    ...STRATEGY_DEFAULTS[optionType],
                    specificSymbol: prev.specificSymbol,
                    targetAssetClasses: prev.targetAssetClasses,
                  }));
                }
              }}
              className="justify-start"
            >
              <ToggleGroupItem value="PUT" className="px-4">
                PUTs
              </ToggleGroupItem>
              <ToggleGroupItem value="CALL" className="px-4">
                CALLs
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              {criteria.optionTypes === "PUT" && "Cash-secured puts for buying opportunities"}
              {criteria.optionTypes === "CALL" && "Covered calls for income on existing positions"}
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="space-y-2">
              <Label>Min Days to Expiry</Label>
              <Input
                type="number"
                value={criteria.minDaysToExpiry}
                onChange={(e) =>
                  setCriteria({ ...criteria, minDaysToExpiry: parseInt(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">Earliest expiration</p>
            </div>
            <div className="space-y-2">
              <Label>Max Days to Expiry</Label>
              <Input
                type="number"
                value={criteria.maxDaysToExpiry}
                onChange={(e) =>
                  setCriteria({ ...criteria, maxDaysToExpiry: parseInt(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">Latest expiration</p>
            </div>
            <div className="space-y-2">
              <Label>Min Delta</Label>
              <Input
                type="number"
                step="0.05"
                value={criteria.minDelta}
                onChange={(e) =>
                  setCriteria({ ...criteria, minDelta: parseFloat(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">0.1 = ~10% ITM chance</p>
            </div>
            <div className="space-y-2">
              <Label>Max Delta</Label>
              <Input
                type="number"
                step="0.05"
                value={criteria.maxDelta}
                onChange={(e) =>
                  setCriteria({ ...criteria, maxDelta: parseFloat(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">0.3 = ~30% ITM chance</p>
            </div>
            <div className="space-y-2">
              <Label>Min Annual Return %</Label>
              <Input
                type="number"
                value={criteria.minAnnualizedReturn}
                onChange={(e) =>
                  setCriteria({ ...criteria, minAnnualizedReturn: parseFloat(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">Premium annualized</p>
            </div>
            <div className="space-y-2">
              <Label>Min Premium %</Label>
              <Input
                type="number"
                step="0.1"
                value={criteria.minPremiumPercent}
                onChange={(e) =>
                  setCriteria({ ...criteria, minPremiumPercent: parseFloat(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">Premium / strike price</p>
            </div>
          </div>

          {/* Strike Range Controls - conditional based on option type */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* PUT Strike Range */}
            {criteria.optionTypes === "PUT" && (
              <>
                <div className="space-y-2">
                  <Label>PUT Min Strike %</Label>
                  <Input
                    type="number"
                    value={criteria.putMinStrikePercent}
                    onChange={(e) =>
                      setCriteria({ ...criteria, putMinStrikePercent: parseInt(e.target.value) || 0 })
                    }
                  />
                  <p className="text-xs text-muted-foreground">Below stock price</p>
                </div>
                <div className="space-y-2">
                  <Label>PUT Max Strike %</Label>
                  <Input
                    type="number"
                    value={criteria.putMaxStrikePercent}
                    onChange={(e) =>
                      setCriteria({ ...criteria, putMaxStrikePercent: parseInt(e.target.value) || 0 })
                    }
                  />
                  <p className="text-xs text-muted-foreground">100% = ATM</p>
                </div>
              </>
            )}
            {/* CALL Strike Range */}
            {criteria.optionTypes === "CALL" && (
              <>
                <div className="space-y-2">
                  <Label>CALL Min Strike %</Label>
                  <Input
                    type="number"
                    value={criteria.callMinStrikePercent}
                    onChange={(e) =>
                      setCriteria({ ...criteria, callMinStrikePercent: parseInt(e.target.value) || 0 })
                    }
                  />
                  <p className="text-xs text-muted-foreground">100% = ATM</p>
                </div>
                <div className="space-y-2">
                  <Label>CALL Max Strike %</Label>
                  <Input
                    type="number"
                    value={criteria.callMaxStrikePercent}
                    onChange={(e) =>
                      setCriteria({ ...criteria, callMaxStrikePercent: parseInt(e.target.value) || 0 })
                    }
                  />
                  <p className="text-xs text-muted-foreground">Above stock price</p>
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label>Specific Symbol (optional)</Label>
            <div className="flex gap-2">
              <Popover open={symbolComboboxOpen} onOpenChange={setSymbolComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={symbolComboboxOpen}
                    className="w-48 justify-between"
                  >
                    {criteria.specificSymbol || "Select symbol..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-0">
                  <Command>
                    <CommandInput placeholder="Search symbols..." />
                    <CommandList>
                      <CommandEmpty>Type any symbol</CommandEmpty>
                      <CommandGroup>
                        {availableSymbols.map((symbol) => (
                          <CommandItem
                            key={symbol}
                            value={symbol}
                            onSelect={(value: string) => {
                              setCriteria({
                                ...criteria,
                                specificSymbol: value.toUpperCase(),
                              });
                              setSymbolComboboxOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                criteria.specificSymbol === symbol ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {symbol}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {criteria.specificSymbol && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCriteria({ ...criteria, specificSymbol: undefined })}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Leave empty to scan all positions and watchlist symbols
            </p>
          </div>

          <div className="space-y-2">
            <Label>Target Asset Classes (optional)</Label>
            <div className={cn(
              "flex flex-wrap gap-2",
              criteria.specificSymbol && "opacity-50 pointer-events-none"
            )}>
              {assetClasses.map((ac) => {
                const isSelected = criteria.targetAssetClasses?.includes(ac.id);
                return (
                  <Badge
                    key={ac.id}
                    variant={isSelected ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => {
                      const current = criteria.targetAssetClasses || [];
                      const updated = isSelected
                        ? current.filter((id) => id !== ac.id)
                        : [...current, ac.id];
                      setCriteria({
                        ...criteria,
                        targetAssetClasses: updated.length > 0 ? updated : undefined,
                      });
                    }}
                  >
                    <div
                      className="h-2 w-2 rounded-full mr-1"
                      style={{ backgroundColor: ac.color }}
                    />
                    {ac.name}
                  </Badge>
                );
              })}
            </div>
            <p className="text-sm text-muted-foreground">
              {criteria.specificSymbol
                ? "Asset class filter is ignored when a symbol is specified"
                : "Leave empty to auto-select underinvested classes"}
            </p>
          </div>

          <Button onClick={handleScan}>
            <Search className="h-4 w-4 mr-2" />
            Run Scan
          </Button>
        </CardContent>
      </Card>

      {/* Scan Jobs */}
      <ScanJobList
        jobs={jobs}
        onCancel={cancelJob}
        onDelete={deleteJob}
        onRescan={handleRescan}
        onClearAll={handleClearCompleted}
        onSellClick={handleSellClick}
        costBasisMap={costBasisMap}
      />

      {/* Sell Option Dialog */}
      <SellOptionDialog
        open={sellDialogOpen}
        onOpenChange={setSellDialogOpen}
        opportunity={selectedOpportunity}
      />
    </div>
  );
}
