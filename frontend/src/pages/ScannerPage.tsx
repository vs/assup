import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api";
import type { ScannerCriteria, ScannerPreset, ScanResult, AssetClass, OptionTypeFilter } from "@assup/shared";
import { cn } from "@/lib/utils";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { GroupedResultsTable, SellOptionDialog } from "@/components/scanner";
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
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Search, Save, X, Check, ChevronsUpDown, Trash2, Settings2 } from "lucide-react";

const DEFAULT_CRITERIA: ScannerCriteria = {
  optionTypes: "PUT",
  minDaysToExpiry: 30,
  maxDaysToExpiry: 60,
  minDelta: 0.2,
  maxDelta: 0.4,
  minAnnualizedReturn: 15,
  minPremiumPercent: 1,
  putMinStrikePercent: 75,
  putMaxStrikePercent: 100,
  callMinStrikePercent: 100,
  callMaxStrikePercent: 125,
};

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

const STORAGE_KEY = "scanner-results";

function loadPersistedResults(): ScanResult | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as ScanResult;
    }
  } catch (err) {
    console.error("Failed to load persisted scan results:", err);
  }
  return null;
}

function persistResults(result: ScanResult | null) {
  try {
    if (result) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    console.error("Failed to persist scan results:", err);
  }
}

export function ScannerPage() {
  const [searchParams] = useSearchParams();
  const [criteria, setCriteria] = useState<ScannerCriteria>(() => {
    // Check URL for pre-selected asset class
    const assetClassId = searchParams.get("assetClassId");
    if (assetClassId) {
      return { ...DEFAULT_CRITERIA, targetAssetClasses: [assetClassId] };
    }
    return DEFAULT_CRITERIA;
  });
  const [presets, setPresets] = useState<ScannerPreset[]>([]);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(loadPersistedResults);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{
    status: string;
    message: string;
    currentSymbol?: number;
    totalSymbols?: number;
    symbol?: string;
    assetClass?: string;
    expirations?: string;
    strikeRange?: string;
    contractCount?: number;
  } | null>(null);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [symbolComboboxOpen, setSymbolComboboxOpen] = useState(false);
  const [presetsPopoverOpen, setPresetsPopoverOpen] = useState(false);
  const [sellDialogOpen, setSellDialogOpen] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState<ExtendedOptionOpportunity | null>(null);

  function handleSellClick(opportunity: ExtendedOptionOpportunity) {
    setSelectedOpportunity(opportunity);
    setSellDialogOpen(true);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [presetsData, acData, positionsData, watchlistsData] = await Promise.all([
        api.scanner.presets.list(),
        api.assetClasses.list(),
        api.positions.list(),
        api.watchlists.list(),
      ]);
      setPresets(presetsData);
      setAssetClasses(acData);

      // Collect unique stock symbols from positions
      const symbolsSet = new Set<string>();
      for (const pos of positionsData) {
        // Only include stocks (STK), not options
        if (pos.secType === "STK") {
          symbolsSet.add(pos.symbol);
        }
      }

      // Fetch all watchlists with items to get symbols
      const watchlistsWithItems = await Promise.all(
        watchlistsData.map((wl) => api.watchlists.get(wl.id))
      );
      for (const wl of watchlistsWithItems) {
        for (const item of wl.items) {
          if (item.secType === "STK") {
            symbolsSet.add(item.symbol);
          }
        }
      }

      setAvailableSymbols(Array.from(symbolsSet).sort());

      // Load default preset if exists, but preserve targetAssetClasses from URL/user selection
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

  function loadPreset(presetId: string) {
    const preset = presets.find((p) => p.id === presetId);
    if (preset) {
      setCriteria(normalizePresetCriteria(preset.criteria));
    }
  }

  async function runScan() {
    try {
      setScanning(true);
      setError(null);
      setScanProgress({ status: "starting", message: "Initializing scan..." });

      // Clear previous results when starting a new scan
      setScanResult(null);
      persistResults(null);

      // Track interim results and scanned symbols
      const interimOpportunities: ScanResult["opportunities"] = [];
      const scannedSymbols: string[] = [];

      // Subscribe to SSE for progress updates
      const eventSource = new EventSource("/api/updates/stream");

      eventSource.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "scanner") {
            setScanProgress(data.data);

            // Handle interim results when a symbol is complete
            if (data.data.status === "symbol_complete" && data.data.opportunities) {
              // Add new opportunities to interim results
              interimOpportunities.push(...data.data.opportunities);
              if (data.data.symbol && !scannedSymbols.includes(data.data.symbol)) {
                scannedSymbols.push(data.data.symbol);
              }

              // Update scan result with interim data
              const interimResult: ScanResult = {
                criteria,
                targetAssetClasses: criteria.targetAssetClasses || [],
                symbolsScanned: [...scannedSymbols],
                opportunities: [...interimOpportunities],
              };
              setScanResult(interimResult);
              persistResults(interimResult);
            }
          }
        } catch (err) {
          console.error("Failed to parse SSE message:", err);
        }
      });

      // Run the scan - this returns the final complete result
      const result = await api.scanner.scan(criteria);
      setScanResult(result);
      persistResults(result);

      // Clean up SSE connection
      eventSource.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
      setScanProgress(null);
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
            {presets.length > 0 && (
              <Popover open={presetsPopoverOpen} onOpenChange={setPresetsPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline">
                    <Settings2 className="h-4 w-4 mr-2" />
                    Presets
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="end">
                  <div className="space-y-1">
                    {presets.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                      >
                        <button
                          className="flex-1 text-left text-sm truncate hover:underline"
                          onClick={() => {
                            loadPreset(p.id);
                            setPresetsPopoverOpen(false);
                          }}
                        >
                          {p.name}
                          {p.isDefault && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                              Default
                            </Badge>
                          )}
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deletePreset(p.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
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
                  setCriteria({ ...criteria, optionTypes: value as OptionTypeFilter });
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
              <ToggleGroupItem value="BOTH" className="px-4">
                Both
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              {criteria.optionTypes === "PUT" && "Cash-secured puts for buying opportunities"}
              {criteria.optionTypes === "CALL" && "Covered calls for income on existing positions"}
              {criteria.optionTypes === "BOTH" && "Scan for both put and call opportunities"}
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
              <p className="text-xs text-muted-foreground">0.2 = ~20% ITM chance</p>
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
              <p className="text-xs text-muted-foreground">0.4 = ~40% ITM chance</p>
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
            {(criteria.optionTypes === "PUT" || criteria.optionTypes === "BOTH") && (
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
            {(criteria.optionTypes === "CALL" || criteria.optionTypes === "BOTH") && (
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

          <Button onClick={runScan} disabled={scanning}>
            <Search className="h-4 w-4 mr-2" />
            {scanning ? "Scanning..." : "Run Scan"}
          </Button>
        </CardContent>
      </Card>

      {/* Scan Progress */}
      {scanning && scanProgress && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{scanProgress.message}</span>
                {scanProgress.currentSymbol && scanProgress.totalSymbols && (
                  <span className="text-muted-foreground">
                    {scanProgress.currentSymbol} / {scanProgress.totalSymbols}
                  </span>
                )}
              </div>

              <Progress
                value={
                  scanProgress.currentSymbol && scanProgress.totalSymbols
                    ? (scanProgress.currentSymbol / scanProgress.totalSymbols) * 100
                    : 0
                }
              />

              {scanProgress.status === "fetching" && (
                <div className="text-sm text-muted-foreground space-y-1">
                  {scanProgress.symbol && (
                    <div>
                      Symbol: <span className="font-medium">{scanProgress.symbol}</span>
                      {scanProgress.assetClass && (
                        <span className="ml-2">({scanProgress.assetClass})</span>
                      )}
                    </div>
                  )}
                  {scanProgress.expirations && (
                    <div>Expirations: {scanProgress.expirations}</div>
                  )}
                  {scanProgress.strikeRange && (
                    <div>Strikes: {scanProgress.strikeRange}</div>
                  )}
                  {scanProgress.contractCount !== undefined && (
                    <div>Contracts: {scanProgress.contractCount}</div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scan Results */}
      {scanResult && (
        <Card>
          <CardHeader>
            <CardTitle>Scan Results</CardTitle>
          </CardHeader>
          <CardContent>
            {scanResult.message && (
              <div className="bg-muted px-4 py-3 rounded-lg mb-4">
                <p className="text-sm">{scanResult.message}</p>
              </div>
            )}

            <div className="mb-4">
              <p className="text-sm text-muted-foreground">
                Scanned {scanResult.symbolsScanned.length} symbols:{" "}
                {scanResult.symbolsScanned.join(", ") || "None"}
              </p>
            </div>

            {scanResult.opportunities.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No opportunities found matching your criteria.
                <br />
                <span className="text-sm">
                  Tip: Options scanning requires active market data subscriptions in TWS.
                </span>
              </p>
            ) : (
              <GroupedResultsTable
                opportunities={scanResult.opportunities}
                onSellClick={handleSellClick}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Sell Option Dialog */}
      <SellOptionDialog
        open={sellDialogOpen}
        onOpenChange={setSellDialogOpen}
        opportunity={selectedOpportunity}
      />
    </div>
  );
}
