import { useState, useEffect, useCallback } from "react";
import type { WheelScanConfig, WheelScan, WheelScanProgress, AssetClass } from "@assup/shared";
import { wheelScannerApi } from "@/api/wheelScanner";
import { assetClassesApi, researchApi } from "@/api";
import { sseManager } from "@/hooks/useSSE";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ConfigEditor } from "./ConfigEditor";
import { CandidateCard } from "./CandidateCard";
import { Plus, Radar, AlertTriangle, Loader2 } from "lucide-react";

type Step = "configure" | "scanning" | "results";

interface DiscoverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTickersAdded: () => void;
}

export function DiscoverDialog({ open, onOpenChange, onTickersAdded }: DiscoverDialogProps) {
  const [step, setStep] = useState<Step>("configure");
  const [configs, setConfigs] = useState<WheelScanConfig[]>([]);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Scan state
  const [scanId, setScanId] = useState<string | null>(null);
  const [progress, setProgress] = useState<WheelScanProgress | null>(null);

  // Results state
  const [scan, setScan] = useState<WheelScan | null>(null);
  const [trackedSymbols, setTrackedSymbols] = useState<Set<string>>(new Set());

  // Load configs and asset classes on open
  useEffect(() => {
    if (!open) return;
    setStep("configure");
    setError(null);
    setScanId(null);
    setProgress(null);
    setScan(null);

    async function load() {
      setLoading(true);
      try {
        const [cfgs, acs, tickers] = await Promise.all([
          wheelScannerApi.configs.list(),
          assetClassesApi.list(),
          researchApi.listTickers(1, 100),
        ]);
        setConfigs(cfgs);
        setAssetClasses(acs);
        setTrackedSymbols(new Set(tickers.tickers.map((t) => t.symbol)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [open]);

  // SSE listener for scan progress
  useEffect(() => {
    if (!scanId) return;

    const remove = sseManager.addListener("wheel_scanner", (rawData) => {
      const data = rawData as WheelScanProgress;
      if (data.scanId !== scanId) return;
      setProgress(data);
    });

    return remove;
  }, [scanId]);

  // Poll for scan completion (fallback for SSE)
  useEffect(() => {
    if (!scanId || step !== "scanning") return;

    const interval = setInterval(async () => {
      try {
        const result = await wheelScannerApi.scans.get(scanId);
        if (result.status === "completed") {
          setScan(result);
          setStep("results");
        } else if (result.status === "failed") {
          setError(result.errorMessage || "Scan failed");
          setStep("configure");
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [scanId, step]);

  const handleStartScan = useCallback(async () => {
    setError(null);
    try {
      const { scanId: id } = await wheelScannerApi.scans.start();
      setScanId(id);
      setProgress(null);
      setStep("scanning");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start scan");
    }
  }, []);

  function handleConfigChange(prevAssetClassId: string, updated: WheelScanConfig) {
    setConfigs((prev) =>
      prev.map((c) => (c.assetClassId === prevAssetClassId ? updated : c))
    );
  }

  async function handleConfigDelete(config: WheelScanConfig) {
    // If it's a new unsaved placeholder, just remove from local state
    if (config.id.startsWith("new-")) {
      setConfigs((prev) => prev.filter((c) => c.id !== config.id));
      return;
    }
    try {
      await wheelScannerApi.configs.delete(config.id);
      setConfigs((prev) => prev.filter((c) => c.id !== config.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete config");
    }
  }

  function handleAddConfig() {
    const configuredIds = new Set(configs.map((c) => c.assetClassId));
    const available = assetClasses.filter((ac) => !configuredIds.has(ac.id));
    if (available.length === 0) return;

    const placeholder: WheelScanConfig = {
      id: `new-${Date.now()}`,
      assetClassId: "",
      searchKeywords: [],
      seedTickers: [],
      minPrice: 15,
      maxPrice: 500,
      minMarketCap: 2e9,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setConfigs((prev) => [...prev, placeholder]);
  }

  function handleTickerAdded(symbol: string) {
    setTrackedSymbols((prev) => new Set([...prev, symbol]));
    onTickersAdded();
  }

  const phaseLabels: Record<string, string> = {
    discovery: "Discovering candidates",
    scoring: "Scoring candidates",
    reports: "Generating reports",
  };

  const progressPct = progress && progress.total > 0
    ? (progress.current / progress.total) * 100
    : 0;

  const acMap = new Map(assetClasses.map((ac) => [ac.id, ac]));
  const configuredIds = new Set(configs.map((c) => c.assetClassId).filter(Boolean));
  const hasAvailableClasses = assetClasses.some((ac) => !configuredIds.has(ac.id));
  const hasSavedConfigs = configs.some((c) => !c.id.startsWith("new-"));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "configure" && "Discover Wheel Candidates"}
            {step === "scanning" && "Scanning..."}
            {step === "results" && "Scan Results"}
          </DialogTitle>
          <DialogDescription>
            {step === "configure" &&
              "Configure search parameters per asset class, then run a scan to find wheel strategy candidates."}
            {step === "scanning" &&
              "Searching for candidates and scoring them based on options data."}
            {step === "results" &&
              "Review candidates and add promising ones to your research pipeline."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Step 1: Configure */}
        {step === "configure" && !loading && (
          <div className="space-y-4">
            {configs.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <p>No scan configs yet. Add one to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {configs.map((config) => (
                  <ConfigEditor
                    key={config.id}
                    config={config}
                    assetClasses={assetClasses}
                    configuredAssetClassIds={configuredIds}
                    isNew={config.id.startsWith("new-")}
                    onChange={(updated) => handleConfigChange(config.assetClassId, updated)}
                    onDelete={() => handleConfigDelete(config)}
                  />
                ))}
              </div>
            )}

            <div className="flex justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddConfig}
                disabled={!hasAvailableClasses}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add Config
              </Button>
              <Button
                onClick={handleStartScan}
                disabled={!hasSavedConfigs}
              >
                <Radar className="h-4 w-4 mr-1.5" />
                Run Scan
              </Button>
            </div>
          </div>
        )}

        {step === "configure" && loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Step 2: Scanning */}
        {step === "scanning" && (
          <div className="space-y-4 py-4">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-3" />
              <p className="font-medium">
                {progress ? phaseLabels[progress.phase] || progress.phase : "Starting scan..."}
              </p>
              {progress && progress.total > 0 && (
                <p className="text-sm text-muted-foreground mt-1">
                  {progress.current} / {progress.total}
                </p>
              )}
            </div>
            <Progress value={progressPct} className="h-2" />
          </div>
        )}

        {/* Step 3: Results */}
        {step === "results" && scan && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Found {scan.scoredCandidates} candidates from {scan.totalCandidates} discovered.
              {scan.reportsTriggered > 0 && ` ${scan.reportsTriggered} reports triggered.`}
            </div>

            {scan.results.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                No candidates found. Try adjusting your search configs.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {scan.results.map((result) => {
                  const ac = acMap.get(result.assetClassId);
                  return (
                    <CandidateCard
                      key={result.id}
                      result={result}
                      assetClassName={ac?.name}
                      assetClassColor={ac?.color}
                      isTracked={trackedSymbols.has(result.symbol)}
                      onAdded={handleTickerAdded}
                    />
                  );
                })}
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
