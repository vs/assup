import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api";
import type { ScannerCriteria, ScannerPreset, ScanResult, AssetClass } from "@assup/shared";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { GroupedResultsTable } from "@/components/scanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Search, Save } from "lucide-react";

const DEFAULT_CRITERIA: ScannerCriteria = {
  minDaysToExpiry: 30,
  maxDaysToExpiry: 60,
  minDelta: 0.2,
  maxDelta: 0.4,
  minAnnualizedReturn: 15,
  minPremiumPercent: 1,
  minStrikePercent: 75,
  maxStrikePercent: 100,
};

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
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
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

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [presetsData, acData] = await Promise.all([
        api.scanner.presets.list(),
        api.assetClasses.list(),
      ]);
      setPresets(presetsData);
      setAssetClasses(acData);

      // Load default preset if exists, but preserve targetAssetClasses from URL/user selection
      const defaultPreset = presetsData.find((p) => p.isDefault);
      if (defaultPreset) {
        setCriteria((prev) => ({
          ...defaultPreset.criteria,
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
      setCriteria(preset.criteria);
    }
  }

  async function runScan() {
    try {
      setScanning(true);
      setError(null);
      setScanProgress({ status: "starting", message: "Initializing scan..." });

      // Subscribe to SSE for progress updates
      const eventSource = new EventSource("/api/updates/stream");

      eventSource.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "scanner") {
            setScanProgress(data.data);
          }
        } catch (err) {
          console.error("Failed to parse SSE message:", err);
        }
      });

      // Run the scan
      const result = await api.scanner.scan(criteria);
      setScanResult(result);

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
              <Select onValueChange={loadPreset}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Load preset..." />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" onClick={savePreset}>
              <Save className="h-4 w-4 mr-2" />
              Save Preset
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            <div className="space-y-2">
              <Label>Min Days to Expiry</Label>
              <Input
                type="number"
                value={criteria.minDaysToExpiry}
                onChange={(e) =>
                  setCriteria({ ...criteria, minDaysToExpiry: parseInt(e.target.value) || 0 })
                }
              />
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
            </div>
            <div className="space-y-2">
              <Label>Min Strike %</Label>
              <Input
                type="number"
                value={criteria.minStrikePercent}
                onChange={(e) =>
                  setCriteria({ ...criteria, minStrikePercent: parseInt(e.target.value) || 0 })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Max Strike %</Label>
              <Input
                type="number"
                value={criteria.maxStrikePercent}
                onChange={(e) =>
                  setCriteria({ ...criteria, maxStrikePercent: parseInt(e.target.value) || 0 })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Target Asset Classes (optional)</Label>
            <div className="flex flex-wrap gap-2">
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
              Leave empty to auto-select underinvested classes
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
              <GroupedResultsTable opportunities={scanResult.opportunities} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
