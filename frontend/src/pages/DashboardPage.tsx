import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";
import type { AllocationProfile, PositionSummary, DashboardSettings } from "@assup/shared";
import { useAllocationUpdates } from "@/hooks/useSSE";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader, ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import {
  AccountSummaryCards,
  AllocationTable,
  type AllocationData,
} from "@/components/dashboard";

const DEFAULT_SETTINGS: DashboardSettings = {
  includeOptions: false,
  optionsWeightMode: "notional",
  chartsExpanded: false,
};

export function DashboardPage() {
  const [profile, setProfile] = useState<AllocationProfile | null>(null);
  const [summary, setSummary] = useState<PositionSummary | null>(null);
  const [settings, setSettings] = useState<DashboardSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleAllocationUpdate = useCallback(() => {
    loadData();
  }, []);
  useAllocationUpdates(handleAllocationUpdate);

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    try {
      setLoading(true);
      const savedSettings = await api.settings.getDashboard().catch(() => DEFAULT_SETTINGS);
      setSettings(savedSettings);

      const [profileData, summaryData] = await Promise.all([
        api.allocationProfiles.getActive().catch(() => null),
        api.positions.summary({
          includeOptions: savedSettings.includeOptions,
          optionsWeightMode: savedSettings.optionsWeightMode,
        }).catch(() => null),
      ]);
      setProfile(profileData);
      setSummary(summaryData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function loadData(overrideSettings?: DashboardSettings) {
    const currentSettings = overrideSettings ?? settings;
    try {
      setLoading(true);
      const [profileData, summaryData] = await Promise.all([
        api.allocationProfiles.getActive().catch(() => null),
        api.positions.summary({
          includeOptions: currentSettings.includeOptions,
          optionsWeightMode: currentSettings.optionsWeightMode,
        }).catch(() => null),
      ]);
      setProfile(profileData);
      setSummary(summaryData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function updateSettings(newSettings: Partial<DashboardSettings>) {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);

    try {
      await api.settings.setDashboard(updated);
    } catch (err) {
      console.error("Failed to save settings:", err);
    }

    loadData(updated);
  }

  // Combine target and actual allocation data
  const allocationData = buildAllocationData(profile, summary, settings);
  const hasOptionsPositions = (summary?.summary.optionsExposure?.length ?? 0) > 0;

  if (loading && !summary) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Allocation Dashboard"
        subtitle="Monitor your portfolio allocation vs. target."
        loading={loading}
        onRefresh={loadData}
        actions={
          <div className="flex items-center gap-2">
            <Switch
              id="include-options"
              checked={settings.includeOptions}
              onCheckedChange={(checked) => updateSettings({ includeOptions: checked })}
            />
            <Label htmlFor="include-options" className="text-sm cursor-pointer">
              Include Options
            </Label>
          </div>
        }
      />

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {/* Account Summary Cards */}
      {summary && (
        <AccountSummaryCards
          summary={summary}
          settings={settings}
          hasOptionsPositions={hasOptionsPositions}
        />
      )}

      {/* Allocation Table */}
      <Card>
        <CardHeader>
          <CardTitle>Allocation Details</CardTitle>
        </CardHeader>
        <CardContent>
          {allocationData.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              Connect to TWS and set up an allocation profile to see details.
            </p>
          ) : (
            <AllocationTable
              data={allocationData}
              netLiquidation={summary?.account.netLiquidation ?? 0}
              includeOptions={settings.includeOptions}
            />
          )}
        </CardContent>
      </Card>

    </div>
  );
}

/**
 * Build allocation data from profile and summary
 */
function buildAllocationData(
  profile: AllocationProfile | null,
  summary: PositionSummary | null,
  settings: DashboardSettings
): AllocationData[] {
  if (!profile || !summary) return [];

  const allocationData: AllocationData[] = [];
  const targetMap = new Map(profile.targets.map((t) => [t.assetClassId, t]));
  const actualMap = new Map(summary.summary.byAssetClass.map((a) => [a.id, a]));

  // Add all targets
  for (const target of profile.targets) {
    const actual = actualMap.get(target.assetClassId);
    allocationData.push({
      id: target.assetClassId,
      name: target.assetClass.name,
      target: target.targetPercentage,
      current: Math.round(actual?.percentage || 0),
      diff: (actual?.percentage || 0) - target.targetPercentage,
      color: target.assetClass.color,
      value: actual?.value || 0,
      stockValue: actual?.stockValue || 0,
      optionsExposure: settings.optionsWeightMode === "delta"
        ? (actual?.optionsDelta || 0)
        : (actual?.optionsNotional || 0),
    });
  }

  // Add unassigned
  if (summary.summary.unassignedPercentage > 0) {
    allocationData.push({
      id: "unassigned",
      name: "Unassigned",
      target: 0,
      current: Math.round(summary.summary.unassignedPercentage),
      diff: summary.summary.unassignedPercentage,
      color: "#9ca3af",
      value: summary.summary.unassignedValue,
      stockValue: summary.summary.unassignedValue,
      optionsExposure: 0,
    });
  }

  // Add actuals without targets
  for (const actual of summary.summary.byAssetClass) {
    if (!targetMap.has(actual.id)) {
      allocationData.push({
        id: actual.id,
        name: actual.name,
        target: 0,
        current: Math.round(actual.percentage),
        diff: actual.percentage,
        color: actual.color,
        value: actual.value,
        stockValue: actual.stockValue,
        optionsExposure: settings.optionsWeightMode === "delta"
          ? actual.optionsDelta
          : actual.optionsNotional,
      });
    }
  }

  // Sort Cash last
  return allocationData.sort((a, b) => {
    if (a.name === "Cash") return 1;
    if (b.name === "Cash") return -1;
    return 0;
  });
}
