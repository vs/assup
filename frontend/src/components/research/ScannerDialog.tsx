import { useState, useEffect, useCallback, useRef } from "react";
import type {
  MarketScannerPreset,
  ScanCodeInfo,
  MarketScanResult,
  ScannerResultItem,
  TechnicalFilterConfig,
} from "@assup/shared";
import { researchApi, settingsApi } from "@/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  Loader2,
  Play,
  Plus,
  Pencil,
  Trash2,
  Radar,
  Check,
  X,
  ArrowLeft,
} from "lucide-react";
import { ScannerPresetEditor } from "./ScannerPresetEditor";

type Step = "configure" | "scanning" | "results";

interface ScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTickersAdded: () => void;
}

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

export function ScannerDialog({ open, onOpenChange, onTickersAdded }: ScannerDialogProps) {
  const [step, setStep] = useState<Step>("configure");
  const [scanCodes, setScanCodes] = useState<ScanCodeInfo[]>([]);
  const [presets, setPresets] = useState<MarketScannerPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quick Scan state
  const [scanCode, setScanCode] = useState("");
  const [locationCode, setLocationCode] = useState("STK.US.MAJOR");
  const [minPrice, setMinPrice] = useState("5");
  const [maxPrice, setMaxPrice] = useState("500");
  const [minVolume, setMinVolume] = useState("100000");
  const [minMarketCap, setMinMarketCap] = useState("");
  const [maxMarketCap, setMaxMarketCap] = useState("");
  const [stockType, setStockType] = useState("");
  const [techEnabled, setTechEnabled] = useState(false);
  const [maxRsi, setMaxRsi] = useState("40");
  const [requireAboveSma200, setRequireAboveSma200] = useState(true);
  const [trendPeriodYears, setTrendPeriodYears] = useState("3");

  // Results state
  const [results, setResults] = useState<MarketScanResult | null>(null);
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [addingTickers, setAddingTickers] = useState(false);

  // Per-ticker generation tracking
  const [generationState, setGenerationState] = useState<
    Map<string, { jobId?: string; status: "queued" | "generating" | "completed" | "failed"; progress?: string; error?: string }>
  >(new Map());
  const [skippedSymbols, setSkippedSymbols] = useState<Set<string>>(new Set());
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Preset editor state
  const [editingPreset, setEditingPreset] = useState<MarketScannerPreset | undefined>(undefined);
  const [showPresetEditor, setShowPresetEditor] = useState(false);

  // Scan job polling state
  const [scanningMessage, setScanningMessage] = useState("Scanning...");

  // Cleanup poll timers on unmount or close
  useEffect(() => {
    if (!open) {
      for (const timer of pollTimers.current.values()) {
        clearInterval(timer);
      }
      pollTimers.current.clear();
    }
  }, [open]);

  // Load scan codes and presets on open
  useEffect(() => {
    if (!open) return;
    setStep("configure");
    setError(null);
    setResults(null);
    setSelectedSymbols(new Set());
    setGenerationState(new Map());
    setSkippedSymbols(new Set());
    setShowPresetEditor(false);
    setEditingPreset(undefined);

    async function load() {
      setLoading(true);
      try {
        const [codes, presetList] = await Promise.all([
          researchApi.getScanCodes(),
          researchApi.listScannerPresets(),
        ]);
        setScanCodes(codes);
        setPresets(presetList);
        if (codes.length > 0 && !scanCode) {
          setScanCode(codes[0].code);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load scanner data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [open]);

  // --- Quick Scan ---
  const handleQuickScan = useCallback(async () => {
    if (!scanCode) {
      setError("Select a scan code first");
      return;
    }

    setError(null);
    setStep("scanning");
    setScanningMessage("Running market scan...");

    try {
      const params: Record<string, unknown> = {
        scanCode,
        locationCode,
      };
      if (minPrice) params.abovePrice = Number(minPrice);
      if (maxPrice) params.belowPrice = Number(maxPrice);
      if (minVolume) params.aboveVolume = Number(minVolume);
      if (minMarketCap) params.marketCapAbove = Number(minMarketCap);
      if (maxMarketCap) params.marketCapBelow = Number(maxMarketCap);
      if (stockType) params.stockTypeFilter = stockType;

      const technicalFilter: TechnicalFilterConfig = {
        enabled: techEnabled,
        ...(techEnabled && {
          maxRsi: Number(maxRsi),
          requireAboveSma200,
          trendPeriodYears: Number(trendPeriodYears),
        }),
      };

      params.technicalFilter = technicalFilter;

      const result = await researchApi.runAdhocScan(params);

      setResults(result);
      // Pre-select all qualified symbols
      setSelectedSymbols(new Set(result.qualified));
      setStep("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setStep("configure");
    }
  }, [scanCode, locationCode, minPrice, maxPrice, minVolume, minMarketCap, maxMarketCap, stockType, techEnabled, maxRsi, requireAboveSma200, trendPeriodYears]);

  // --- Preset Run ---
  const handleRunPreset = useCallback(async (preset: MarketScannerPreset) => {
    setError(null);
    setStep("scanning");
    setScanningMessage(`Running preset "${preset.name}"...`);

    try {
      const { jobId } = await researchApi.runScannerPreset(preset.id);

      // Poll job status
      const maxAttempts = 60; // 2 minutes at 2s intervals
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const job = await researchApi.getJob(jobId);

        if (job.progress) {
          setScanningMessage(job.progress);
        }

        if (job.status === "completed") {
          const jobResult = job.result as unknown as MarketScanResult | undefined;
          if (jobResult) {
            setResults(jobResult);
            setSelectedSymbols(new Set(jobResult.qualified));
            setStep("results");
          } else {
            setError("Scan completed but no results returned");
            setStep("configure");
          }
          return;
        }

        if (job.status === "failed") {
          setError(job.error || "Scan failed");
          setStep("configure");
          return;
        }
      }

      setError("Scan timed out");
      setStep("configure");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run preset");
      setStep("configure");
    }
  }, []);

  // --- Preset CRUD ---
  async function handlePresetSave(preset: MarketScannerPreset) {
    try {
      if (preset.id) {
        const updated = await researchApi.updateScannerPreset(preset.id, preset);
        setPresets((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } else {
        const { id: _id, lastRun: _lr, ...createData } = preset;
        const created = await researchApi.createScannerPreset(createData);
        setPresets((prev) => [...prev, created]);
      }
      setShowPresetEditor(false);
      setEditingPreset(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preset");
    }
  }

  async function handlePresetDelete(id: string) {
    try {
      await researchApi.deleteScannerPreset(id);
      setPresets((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete preset");
    }
  }

  // --- Add Tickers and generate reports ---
  async function handleAddSelected() {
    if (selectedSymbols.size === 0) return;
    setAddingTickers(true);
    setError(null);
    try {
      const { added, skipped } = await researchApi.addTickers({
        symbols: Array.from(selectedSymbols),
        source: "scanner",
      });
      onTickersAdded();

      // Track skipped symbols
      setSkippedSymbols(new Set(skipped));

      // Initialize generation state for added tickers
      const initial = new Map<string, { jobId?: string; status: "queued" | "generating" | "completed" | "failed"; progress?: string; error?: string }>();
      for (const t of added) {
        initial.set(t.symbol, { status: "queued" });
      }
      setGenerationState(initial);

      // Get research settings for synthesizer mode
      const researchSettings = await settingsApi
        .get<{ synthesizerMode: string; model?: string }>("research")
        .then((r) => r.value)
        .catch(() => ({ synthesizerMode: undefined, model: undefined }));

      // Fire off report generation for each added ticker
      for (const t of added) {
        try {
          const { jobId } = await researchApi.generate(t.symbol, {
            force: true,
            mode: researchSettings.synthesizerMode,
            model: researchSettings.model,
          });

          setGenerationState((prev) => {
            const next = new Map(prev);
            next.set(t.symbol, { jobId, status: "generating", progress: "Starting..." });
            return next;
          });

          // Start polling for this job
          const timer = setInterval(async () => {
            try {
              const job = await researchApi.getJob(jobId);
              if (job.status === "completed") {
                clearInterval(timer);
                pollTimers.current.delete(t.symbol);
                setGenerationState((prev) => {
                  const next = new Map(prev);
                  next.set(t.symbol, { jobId, status: "completed" });
                  return next;
                });
              } else if (job.status === "failed") {
                clearInterval(timer);
                pollTimers.current.delete(t.symbol);
                setGenerationState((prev) => {
                  const next = new Map(prev);
                  next.set(t.symbol, { jobId, status: "failed", error: job.error || "Failed" });
                  return next;
                });
              } else {
                setGenerationState((prev) => {
                  const next = new Map(prev);
                  next.set(t.symbol, { jobId, status: "generating", progress: job.progress || "Processing..." });
                  return next;
                });
              }
            } catch {
              // Ignore poll errors, will retry on next interval
            }
          }, 2000);
          pollTimers.current.set(t.symbol, timer);
        } catch {
          setGenerationState((prev) => {
            const next = new Map(prev);
            next.set(t.symbol, { status: "failed", error: "Failed to start generation" });
            return next;
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add tickers");
    } finally {
      setAddingTickers(false);
    }
  }

  // --- Selection helpers ---
  function toggleSymbol(symbol: string) {
    setSelectedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  }

  function toggleAll() {
    if (!results) return;
    const allSymbols = results.scored.map((r) => r.symbol);
    if (selectedSymbols.size === allSymbols.length) {
      setSelectedSymbols(new Set());
    } else {
      setSelectedSymbols(new Set(allSymbols));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "configure" && "Market Scanner"}
            {step === "scanning" && "Scanning..."}
            {step === "results" && "Scan Results"}
          </DialogTitle>
          <DialogDescription>
            {step === "configure" &&
              "Scan the market for stocks matching your criteria using TWS scanner."}
            {step === "scanning" &&
              "Running the market scanner. This may take a moment."}
            {step === "results" &&
              "Review results and add promising tickers to your research pipeline."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Step 1: Configure */}
        {step === "configure" && !loading && !showPresetEditor && (
          <Tabs defaultValue="quick">
            <TabsList>
              <TabsTrigger value="quick">Quick Scan</TabsTrigger>
              <TabsTrigger value="presets">Presets</TabsTrigger>
            </TabsList>

            {/* Quick Scan Tab */}
            <TabsContent value="quick">
              <div className="space-y-4 pt-2">
                {/* Scan code + Location */}
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
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Min Price</label>
                      <Input
                        type="number"
                        value={minPrice}
                        onChange={(e) => setMinPrice(e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Max Price</label>
                      <Input
                        type="number"
                        value={maxPrice}
                        onChange={(e) => setMaxPrice(e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Min Volume</label>
                      <Input
                        type="number"
                        value={minVolume}
                        onChange={(e) => setMinVolume(e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Min Market Cap</label>
                      <Input
                        type="number"
                        value={minMarketCap}
                        onChange={(e) => setMinMarketCap(e.target.value)}
                        placeholder=""
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
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Stock Type</label>
                      <Select value={stockType || "__all__"} onValueChange={(v) => setStockType(v === "__all__" ? "" : v)}>
                        <SelectTrigger className="w-full h-8">
                          <SelectValue />
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
                  </div>
                </div>

                {/* Technical Filter */}
                <div className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Technical Filter</Label>
                    <Switch
                      checked={techEnabled}
                      onCheckedChange={setTechEnabled}
                    />
                  </div>
                  {techEnabled && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Max RSI</label>
                          <Input
                            type="number"
                            value={maxRsi}
                            onChange={(e) => setMaxRsi(e.target.value)}
                            className="h-8"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Trend Period (years)</label>
                          <Input
                            type="number"
                            value={trendPeriodYears}
                            onChange={(e) => setTrendPeriodYears(e.target.value)}
                            className="h-8"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={requireAboveSma200}
                          onCheckedChange={setRequireAboveSma200}
                        />
                        <Label className="text-sm">Require above SMA200</Label>
                      </div>
                    </div>
                  )}
                </div>

                {/* Run Button */}
                <div className="flex justify-end">
                  <Button onClick={handleQuickScan} disabled={!scanCode}>
                    <Radar className="h-4 w-4 mr-1.5" />
                    Run Scan
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* Presets Tab */}
            <TabsContent value="presets">
              <div className="space-y-3 pt-2">
                {presets.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <p>No presets saved yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {presets.map((preset) => (
                      <div
                        key={preset.id}
                        className="rounded-lg border p-3 flex items-center justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{preset.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {preset.scanCode}
                            </Badge>
                            {!preset.enabled && (
                              <Badge variant="secondary" className="text-xs">
                                Disabled
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {preset.locationCode}
                            {preset.schedule && ` | ${preset.schedule}`}
                            {preset.lastRun && ` | Last: ${new Date(preset.lastRun).toLocaleDateString()}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleRunPreset(preset)}
                            title="Run preset"
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              setEditingPreset(preset);
                              setShowPresetEditor(true);
                            }}
                            title="Edit preset"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handlePresetDelete(preset.id)}
                            title="Delete preset"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingPreset(undefined);
                    setShowPresetEditor(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  New Preset
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* Preset Editor overlay */}
        {step === "configure" && !loading && showPresetEditor && (
          <div className="space-y-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowPresetEditor(false);
                setEditingPreset(undefined);
              }}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to presets
            </Button>
            <ScannerPresetEditor
              preset={editingPreset}
              scanCodes={scanCodes}
              onSave={handlePresetSave}
              onCancel={() => {
                setShowPresetEditor(false);
                setEditingPreset(undefined);
              }}
            />
          </div>
        )}

        {step === "configure" && loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Step 2: Scanning */}
        {step === "scanning" && (
          <div className="space-y-4 py-8">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-3" />
              <p className="font-medium">{scanningMessage}</p>
              <p className="text-sm text-muted-foreground mt-1">
                This may take up to a minute depending on TWS response time.
              </p>
            </div>
          </div>
        )}

        {/* Step 3: Results */}
        {step === "results" && results && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>
                {results.discovered.length} discovered, {results.scored.length} scored
              </span>
              {results.qualified.length > 0 && (
                <Badge variant="secondary">
                  {results.qualified.length} qualified
                </Badge>
              )}
              {results.added.length > 0 && (
                <Badge variant="outline" className="text-green-600 border-green-600/30">
                  {results.added.length} auto-added
                </Badge>
              )}
              {results.skipped.length > 0 && (
                <span>{results.skipped.length} skipped (already tracked)</span>
              )}
            </div>

            {/* Results Table */}
            {results.scored.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <p>No results from this scan.</p>
                <p className="text-sm mt-1">Try adjusting your filters or using a different scan code.</p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          checked={selectedSymbols.size === results.scored.length && results.scored.length > 0}
                          onChange={toggleAll}
                          className="rounded border-muted-foreground/50"
                        />
                      </TableHead>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead className="hidden md:table-cell">Name</TableHead>
                      <TableHead className="hidden lg:table-cell">Industry</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>RSI</TableHead>
                      <TableHead>SMA200</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.scored.map((item) => (
                      <ResultRow
                        key={item.symbol}
                        item={item}
                        isQualified={results.qualified.includes(item.symbol)}
                        isSelected={selectedSymbols.has(item.symbol)}
                        onToggle={() => toggleSymbol(item.symbol)}
                        genState={generationState.get(item.symbol)}
                        isSkipped={skippedSymbols.has(item.symbol)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStep("configure");
                  setResults(null);
                  setSelectedSymbols(new Set());
                  setGenerationState(new Map());
                  setSkippedSymbols(new Set());
                  for (const timer of pollTimers.current.values()) {
                    clearInterval(timer);
                  }
                  pollTimers.current.clear();
                }}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <div className="flex items-center gap-2">
                {generationState.size === 0 && selectedSymbols.size > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {selectedSymbols.size} selected
                  </span>
                )}
                {generationState.size > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {Array.from(generationState.values()).filter((s) => s.status === "completed").length}/{generationState.size} done
                  </span>
                )}
                {generationState.size === 0 ? (
                  <Button
                    onClick={handleAddSelected}
                    disabled={selectedSymbols.size === 0 || addingTickers}
                  >
                    {addingTickers ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-1.5" />
                    )}
                    Add Selected to Research
                  </Button>
                ) : (
                  <Button onClick={() => onOpenChange(false)}>
                    Done
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Result Row ---

function ResultRow({
  item,
  isQualified,
  isSelected,
  onToggle,
  genState,
  isSkipped,
}: {
  item: ScannerResultItem;
  isQualified: boolean;
  isSelected: boolean;
  onToggle: () => void;
  genState?: { jobId?: string; status: "queued" | "generating" | "completed" | "failed"; progress?: string; error?: string };
  isSkipped?: boolean;
}) {
  const tech = item.technical;
  const rsi = tech?.details.rsi14;
  const aboveSma200 = tech?.details.aboveSma200;
  const score = tech?.score;
  const passed = tech?.passed;

  const hasGeneration = genState || isSkipped;

  return (
    <TableRow className={isQualified ? "bg-green-500/5" : passed === false ? "bg-red-500/5" : ""}>
      <TableCell>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          disabled={!!hasGeneration}
          className="rounded border-muted-foreground/50"
        />
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">{item.rank}</TableCell>
      <TableCell className="font-semibold">{item.symbol}</TableCell>
      <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[200px] truncate">
        {item.longName || "--"}
      </TableCell>
      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground max-w-[150px] truncate">
        {item.industry || "--"}
      </TableCell>
      <TableCell>
        {score != null ? (
          <span className={`text-sm font-medium ${score >= 60 ? "text-green-600" : score >= 40 ? "text-amber-600" : "text-red-600"}`}>
            {score}/100
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">--</span>
        )}
      </TableCell>
      <TableCell>
        {rsi != null ? (
          <span className={`text-sm ${rsi <= 30 ? "text-green-600" : rsi >= 70 ? "text-red-600" : ""}`}>
            {rsi.toFixed(0)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">--</span>
        )}
      </TableCell>
      <TableCell>
        {aboveSma200 != null ? (
          aboveSma200 ? (
            <Badge variant="outline" className="text-xs text-green-600 border-green-600/30">
              Above
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-red-600 border-red-600/30">
              Below
            </Badge>
          )
        ) : (
          <span className="text-sm text-muted-foreground">--</span>
        )}
      </TableCell>
      <TableCell className="text-center">
        {isSkipped ? (
          <span className="text-xs text-muted-foreground">Already tracked</span>
        ) : genState?.status === "queued" ? (
          <span className="text-xs text-muted-foreground">Queued...</span>
        ) : genState?.status === "generating" ? (
          <span className="inline-flex items-center gap-1 text-xs text-blue-600">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="truncate max-w-[120px]">{genState.progress || "Processing..."}</span>
          </span>
        ) : genState?.status === "completed" ? (
          <Check className="h-4 w-4 text-green-600 mx-auto" />
        ) : genState?.status === "failed" ? (
          <span className="inline-flex items-center gap-1 text-xs text-red-600" title={genState.error}>
            <X className="h-3.5 w-3.5" />
            Failed
          </span>
        ) : passed != null ? (
          passed ? (
            <Check className="h-4 w-4 text-green-600 mx-auto" />
          ) : (
            <span className="text-red-600 text-xs font-medium">Fail</span>
          )
        ) : (
          <span className="text-sm text-muted-foreground">--</span>
        )}
      </TableCell>
    </TableRow>
  );
}
