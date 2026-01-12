import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api";
import type { ScannerCriteria, ScannerPreset, ScanResult, AssetClass } from "@assup/shared";
import { formatCurrency } from "@assup/shared";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Save } from "lucide-react";

const DEFAULT_CRITERIA: ScannerCriteria = {
  minDaysToExpiry: 30,
  maxDaysToExpiry: 60,
  minDelta: 0.2,
  maxDelta: 0.4,
  minAnnualizedReturn: 15,
  minPremiumPercent: 1,
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

      // Load default preset if exists
      const defaultPreset = presetsData.find((p) => p.isDefault);
      if (defaultPreset) {
        setCriteria(defaultPreset.criteria);
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
      const result = await api.scanner.scan(criteria);
      setScanResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
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

  const fmtCurrency = (value: number) => formatCurrency(value, { maximumFractionDigits: 0 });

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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Strike</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Delta</TableHead>
                    <TableHead className="text-right">Premium</TableHead>
                    <TableHead className="text-right">Annual Return</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scanResult.opportunities.map((opp: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{opp.symbol}</TableCell>
                      <TableCell>{opp.strike}</TableCell>
                      <TableCell>{opp.expiry}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{opp.optionType}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{opp.delta?.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{fmtCurrency(opp.mid || 0)}</TableCell>
                      <TableCell className="text-right">{opp.annualizedReturn?.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
