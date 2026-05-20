import { useState } from "react";
import type { WheelStrategy, WheelStrategyInput } from "@assup/shared";
import type { Recommendation } from "@assup/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface StrategyConfigProps {
  strategy: WheelStrategy | null;
  onSave: (input: WheelStrategyInput) => void;
  onScanNow: () => void;
  saving?: boolean;
  scanning?: boolean;
}

const DEFAULT_VALUES: Required<Omit<WheelStrategyInput, "name" | "targetAssetClasses">> & {
  targetAssetClasses: string[];
} = {
  enabled: true,
  minMarketCap: 5e9,
  cspMinDte: 25,
  cspMaxDte: 35,
  cspMaxDelta: -0.34,
  cspMinRoi: 2.5,
  cspMaxRoi: 3.5,
  ccMinDte: 5,
  ccMaxDte: 10,
  ccMinRoi: null,
  maxPositions: 10,
  maxPerAssetClass: 2,
  targetAssetClasses: [],
  acceptedRecommendations: ["buy", "wheel"] as Recommendation[],
  minResearchConfidence: null,
  requireFreshReport: false,
  reportMaxAgeDays: 30,
  intervalHours: 4,
  cronExpression: null,
};

const ALL_RECOMMENDATIONS: Recommendation[] = ["buy", "wheel", "hold"];

export function StrategyConfig({
  strategy,
  onSave,
  onScanNow,
  saving,
  scanning,
}: StrategyConfigProps) {
  const [name, setName] = useState(strategy?.name ?? "");
  const [enabled, setEnabled] = useState(strategy?.enabled ?? DEFAULT_VALUES.enabled);

  // CSP Parameters
  const [minMarketCap, setMinMarketCap] = useState(
    String((strategy?.minMarketCap ?? DEFAULT_VALUES.minMarketCap) / 1e9)
  );
  const [cspMinDte, setCspMinDte] = useState(
    String(strategy?.cspMinDte ?? DEFAULT_VALUES.cspMinDte)
  );
  const [cspMaxDte, setCspMaxDte] = useState(
    String(strategy?.cspMaxDte ?? DEFAULT_VALUES.cspMaxDte)
  );
  const [cspMaxDelta, setCspMaxDelta] = useState(
    String(strategy?.cspMaxDelta ?? DEFAULT_VALUES.cspMaxDelta)
  );
  const [cspMinRoi, setCspMinRoi] = useState(
    String(strategy?.cspMinRoi ?? DEFAULT_VALUES.cspMinRoi)
  );
  const [cspMaxRoi, setCspMaxRoi] = useState(
    String(strategy?.cspMaxRoi ?? DEFAULT_VALUES.cspMaxRoi)
  );

  // CC Parameters
  const [ccMinDte, setCcMinDte] = useState(
    String(strategy?.ccMinDte ?? DEFAULT_VALUES.ccMinDte)
  );
  const [ccMaxDte, setCcMaxDte] = useState(
    String(strategy?.ccMaxDte ?? DEFAULT_VALUES.ccMaxDte)
  );
  const [ccMinRoi, setCcMinRoi] = useState(
    strategy?.ccMinRoi != null ? String(strategy.ccMinRoi) : ""
  );

  // Diversification
  const [maxPositions, setMaxPositions] = useState(
    String(strategy?.maxPositions ?? DEFAULT_VALUES.maxPositions)
  );
  const [maxPerAssetClass, setMaxPerAssetClass] = useState(
    String(strategy?.maxPerAssetClass ?? DEFAULT_VALUES.maxPerAssetClass)
  );

  // Research Filter
  const [acceptedRecommendations, setAcceptedRecommendations] = useState<Recommendation[]>(
    strategy?.acceptedRecommendations ?? DEFAULT_VALUES.acceptedRecommendations
  );
  const [minResearchConfidence, setMinResearchConfidence] = useState(
    strategy?.minResearchConfidence != null ? String(strategy.minResearchConfidence) : ""
  );
  const [requireFreshReport, setRequireFreshReport] = useState(
    strategy?.requireFreshReport ?? DEFAULT_VALUES.requireFreshReport
  );
  const [reportMaxAgeDays, setReportMaxAgeDays] = useState(
    String(strategy?.reportMaxAgeDays ?? DEFAULT_VALUES.reportMaxAgeDays)
  );

  // Schedule
  const [intervalHours, setIntervalHours] = useState(
    strategy?.intervalHours != null ? String(strategy.intervalHours) : String(DEFAULT_VALUES.intervalHours)
  );
  const [cronExpression, setCronExpression] = useState(strategy?.cronExpression ?? "");

  function toggleRecommendation(rec: Recommendation) {
    setAcceptedRecommendations((prev) =>
      prev.includes(rec) ? prev.filter((r) => r !== rec) : [...prev, rec]
    );
  }

  function handleSave() {
    const input: WheelStrategyInput = {
      name,
      enabled,
      minMarketCap: parseFloat(minMarketCap) * 1e9,
      cspMinDte: parseInt(cspMinDte, 10),
      cspMaxDte: parseInt(cspMaxDte, 10),
      cspMaxDelta: parseFloat(cspMaxDelta),
      cspMinRoi: parseFloat(cspMinRoi),
      cspMaxRoi: parseFloat(cspMaxRoi),
      ccMinDte: parseInt(ccMinDte, 10),
      ccMaxDte: parseInt(ccMaxDte, 10),
      ccMinRoi: ccMinRoi !== "" ? parseFloat(ccMinRoi) : null,
      maxPositions: parseInt(maxPositions, 10),
      maxPerAssetClass: parseInt(maxPerAssetClass, 10),
      acceptedRecommendations,
      minResearchConfidence: minResearchConfidence !== "" ? parseFloat(minResearchConfidence) : null,
      requireFreshReport,
      reportMaxAgeDays: parseInt(reportMaxAgeDays, 10),
      intervalHours: intervalHours !== "" ? parseFloat(intervalHours) : null,
      cronExpression: cronExpression !== "" ? cronExpression : null,
    };
    onSave(input);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle>{strategy ? "Edit Strategy" : "New Strategy"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label htmlFor="strategy-name" className="mb-1.5 block">
                Strategy Name
              </Label>
              <Input
                id="strategy-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Wheel Strategy – Tech"
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch
                id="strategy-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <Label htmlFor="strategy-enabled">Enabled</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CSP Parameters */}
      <Card>
        <CardHeader>
          <CardTitle>Cash-Secured Put (CSP) Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Min Market Cap (B)
              </Label>
              <Input
                type="number"
                className="w-28"
                value={minMarketCap}
                onChange={(e) => setMinMarketCap(e.target.value)}
                step="0.5"
                min="0"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                DTE Range
              </Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  className="w-20"
                  value={cspMinDte}
                  onChange={(e) => setCspMinDte(e.target.value)}
                  min="0"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="number"
                  className="w-20"
                  value={cspMaxDte}
                  onChange={(e) => setCspMaxDte(e.target.value)}
                  min="0"
                />
                <span className="text-xs text-muted-foreground">days</span>
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Max Delta
              </Label>
              <Input
                type="number"
                className="w-24"
                value={cspMaxDelta}
                onChange={(e) => setCspMaxDelta(e.target.value)}
                step="0.01"
                min="-1"
                max="0"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                ROI Range (%)
              </Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  className="w-20"
                  value={cspMinRoi}
                  onChange={(e) => setCspMinRoi(e.target.value)}
                  step="0.1"
                  min="0"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="number"
                  className="w-20"
                  value={cspMaxRoi}
                  onChange={(e) => setCspMaxRoi(e.target.value)}
                  step="0.1"
                  min="0"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CC Parameters */}
      <Card>
        <CardHeader>
          <CardTitle>Covered Call (CC) Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                DTE Range
              </Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  className="w-20"
                  value={ccMinDte}
                  onChange={(e) => setCcMinDte(e.target.value)}
                  min="0"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="number"
                  className="w-20"
                  value={ccMaxDte}
                  onChange={(e) => setCcMaxDte(e.target.value)}
                  min="0"
                />
                <span className="text-xs text-muted-foreground">days</span>
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Min ROI (optional, %)
              </Label>
              <Input
                type="number"
                className="w-24"
                value={ccMinRoi}
                onChange={(e) => setCcMinRoi(e.target.value)}
                placeholder="—"
                step="0.1"
                min="0"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Diversification */}
      <Card>
        <CardHeader>
          <CardTitle>Diversification</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Max Positions
              </Label>
              <Input
                type="number"
                className="w-24"
                value={maxPositions}
                onChange={(e) => setMaxPositions(e.target.value)}
                min="1"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Max Per Asset Class
              </Label>
              <Input
                type="number"
                className="w-24"
                value={maxPerAssetClass}
                onChange={(e) => setMaxPerAssetClass(e.target.value)}
                min="1"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Research Filter */}
      <Card>
        <CardHeader>
          <CardTitle>Research Filter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-2 block text-xs text-muted-foreground">
              Accepted Recommendations
            </Label>
            <div className="flex items-center gap-4">
              {ALL_RECOMMENDATIONS.map((rec) => (
                <label
                  key={rec}
                  className="flex items-center gap-1.5 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={acceptedRecommendations.includes(rec)}
                    onChange={() => toggleRecommendation(rec)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span className="capitalize">{rec}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Min Confidence (0–1, optional)
              </Label>
              <Input
                type="number"
                className="w-28"
                value={minResearchConfidence}
                onChange={(e) => setMinResearchConfidence(e.target.value)}
                placeholder="—"
                step="0.05"
                min="0"
                max="1"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Report Max Age (days)
              </Label>
              <Input
                type="number"
                className="w-24"
                value={reportMaxAgeDays}
                onChange={(e) => setReportMaxAgeDays(e.target.value)}
                min="1"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="require-fresh-report"
              checked={requireFreshReport}
              onCheckedChange={setRequireFreshReport}
            />
            <Label htmlFor="require-fresh-report">Require fresh report</Label>
          </div>
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Interval (hours)
              </Label>
              <Input
                type="number"
                className="w-24"
                value={intervalHours}
                onChange={(e) => setIntervalHours(e.target.value)}
                placeholder="—"
                step="0.5"
                min="0.5"
              />
            </div>
            <div className="flex-1 min-w-48">
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Cron Expression (optional, overrides interval)
              </Label>
              <Input
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                placeholder="e.g. 0 9 * * 1-5"
                className="font-mono"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Scans run only during market hours (9:30–16:00 ET, Mon–Fri).
          </p>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? "Saving..." : "Save Strategy"}
        </Button>
        <Button
          variant="outline"
          onClick={onScanNow}
          disabled={scanning || !strategy}
        >
          {scanning ? "Scanning..." : "Scan Now"}
        </Button>
      </div>
    </div>
  );
}
