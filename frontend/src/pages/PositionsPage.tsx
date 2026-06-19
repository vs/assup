import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { settingsApi } from "@/api/settings";
import type { Position, AssetClass, AllocationProfile, PositionSummary, DashboardSettings } from "@assup/shared";
import { formatCurrency } from "@assup/shared";
import { useAllocationUpdates } from "@/hooks/useSSE";
import { useSparklines } from "@/hooks/useSparklines";
import { usePositionFilters } from "@/hooks/usePositionFilters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";
import { useTickerProfileContext } from "@/components/common/TickerProfileProvider";
import { PositionTable, GroupedPositionsTable } from "@/components/positions";
import type { AllocationData } from "@/components/positions";
import { ChartModal } from "@/components/ChartModal";
import { ChevronRight, ChevronDown, RefreshCw, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import {
  groupPositionsIntoSpreads,
  formatLiveSpreadName,
  spreadTypeBadgeProps,
  type PositionSpreadGroup,
} from "@/utils/spreadGrouping";

const DEFAULT_SPREAD_SYMBOLS = ["SPX", "XSP", "RUT"];

const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  includeOptions: false,
  optionsWeightMode: "notional",
  chartsExpanded: false,
};

export function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [profile, setProfile] = useState<AllocationProfile | null>(null);
  const [summary, setSummary] = useState<PositionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [spreadSymbols, setSpreadSymbols] = useState<Set<string>>(new Set(DEFAULT_SPREAD_SYMBOLS));
  const [dashboardSettings, setDashboardSettings] = useState<DashboardSettings>(DEFAULT_DASHBOARD_SETTINGS);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const { filters, setFilters } = usePositionFilters();

  const loadDataRef = useRef(loadData);
  useEffect(() => {
    loadDataRef.current = loadData;
  });

  // Subscribe to real-time allocation updates
  const handleAllocationUpdate = useCallback(() => {
    loadDataRef.current();
  }, []);
  useAllocationUpdates(handleAllocationUpdate);

  useEffect(() => {
    loadDataRef.current();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [posData, acData, summaryData] = await Promise.all([
        api.positions.list(),
        api.assetClasses.list(),
        api.positions.summary({ includeOptions: filters.includeOptions, optionsWeightMode: filters.optionsWeightMode }),
      ]);
      setPositions(posData);
      setAssetClasses(acData);
      setSummary(summaryData);

      // Load spread-eligible symbols
      try {
        const spreadSettings = await settingsApi.get<{ symbols: string[] }>("spreads");
        if (spreadSettings.value?.symbols?.length > 0) {
          setSpreadSymbols(new Set(spreadSettings.value.symbols));
        }
      } catch { /* use defaults */ }

      // Load active allocation profile
      try {
        const profileData = await api.allocationProfiles.getActive();
        setProfile(profileData);
      } catch {
        setProfile(null);
      }

      // Load dashboard settings for allocation display
      try {
        const savedSettings = await api.settings.getDashboard();
        setDashboardSettings(savedSettings);
      } catch { /* use defaults */ }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load positions");
    } finally {
      setLoading(false);
    }
  }

  async function handleAssign(position: Position, assetClassId: string) {
    const key = `${position.symbol}:${position.secType}`;
    setAssigning(key);

    try {
      // For options, use the underlying symbol for assignment lookup consistency
      const isOption = position.secType === "OPT";
      const assignmentSymbol = isOption && position.underlying ? position.underlying : position.symbol;
      const assignmentSecType = isOption ? "STK" : position.secType;

      await api.securityAssignments.create({
        symbol: assignmentSymbol,
        conId: position.conId,
        secType: assignmentSecType,
        assetClassId,
        source: "position",
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign security");
    } finally {
      setAssigning(null);
    }
  }

  const handleToggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // Separate spread positions from regular positions
  const spreadPositions = useMemo(() => {
    return positions.filter((p) =>
      p.secType === "OPT" && p.underlying && spreadSymbols.has(p.underlying)
    );
  }, [positions, spreadSymbols]);

  // Apply filters (excluding spread positions from main table)
  const filteredPositions = useMemo(() => {
    return positions.filter((p) => {
      // Exclude spread-eligible options from main table
      if (p.secType === "OPT" && p.underlying && spreadSymbols.has(p.underlying)) return false;
      if (!filters.includeOptions && p.secType === "OPT") return false;
      return true;
    });
  }, [positions, filters, spreadSymbols]);

  const netLiquidation = summary?.account.netLiquidation ?? 0;
  const optionsCount = positions.filter((p) =>
    p.secType === "OPT" && !(p.underlying && spreadSymbols.has(p.underlying))
  ).length;

  // Build allocation data for grouped view
  const allocationData = useMemo(() => {
    return buildAllocationData(profile, summary, dashboardSettings);
  }, [profile, summary, dashboardSettings]);

  // Sparklines
  const sparklineSymbols = useMemo(() => {
    const uniqueSymbols = new Set<string>();
    for (const pos of filteredPositions) {
      if (pos.secType === "CASH") continue;
      const symbol = pos.underlying || pos.symbol;
      uniqueSymbols.add(symbol);
    }
    return Array.from(uniqueSymbols);
  }, [filteredPositions]);

  const { getSparklineState } = useSparklines(sparklineSymbols);

  const { prefetch } = useTickerProfileContext();

  useEffect(() => {
    if (positions.length) {
      const symbols = [...new Set(positions.map((p) => p.underlying || p.symbol).filter(Boolean))];
      prefetch(symbols);
    }
  }, [positions, prefetch]);

  const getPositionSparkline = useCallback((pos: Position) => {
    if (pos.secType === "CASH") {
      return {
        data: [{ date: "1", close: 1 }, { date: "2", close: 1 }],
        loading: false,
        error: false,
      };
    }
    const symbol = pos.underlying || pos.symbol;
    return getSparklineState(symbol);
  }, [getSparklineState]);

  const showGroupedView = allocationData.length > 0;

  if (loading && positions.length === 0) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Positions</h1>
          <p className="text-muted-foreground">
            Portfolio allocation and position details.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="include-options"
              checked={filters.includeOptions}
              onCheckedChange={(checked) => setFilters({ ...filters, includeOptions: checked })}
            />
            <Label htmlFor="include-options" className="text-sm cursor-pointer">
              Options {optionsCount > 0 && `(${optionsCount})`}
            </Label>
          </div>
          {showGroupedView && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const allIds = allocationData.map((r) => r.id ?? "unassigned");
                const allExpanded = expandedGroups.size === allocationData.length;
                if (allExpanded) {
                  for (const id of expandedGroups) handleToggleGroup(id);
                } else {
                  for (const id of allIds) {
                    if (!expandedGroups.has(id)) handleToggleGroup(id);
                  }
                }
              }}
            >
              {expandedGroups.size === allocationData.length ? (
                <><ChevronsDownUp className="h-4 w-4 mr-1" /> Collapse</>
              ) : (
                <><ChevronsUpDown className="h-4 w-4 mr-1" /> Expand</>
              )}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {/* Spread Positions */}
      {spreadPositions.length > 0 && (() => {
        const { spreads, ungrouped } = groupPositionsIntoSpreads(spreadPositions);
        return (spreads.length > 0 || ungrouped.length > 0) && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <CardTitle>Spread Positions</CardTitle>
                <Badge variant="secondary">{spreads.length} spreads</Badge>
                {ungrouped.length > 0 && (
                  <Badge variant="outline">{ungrouped.length} unmatched</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Spread</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Net Cost</TableHead>
                    <TableHead className="text-right">Market Value</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spreads.map((spread, idx) => (
                    <SpreadPositionRow key={`spread-${idx}`} spread={spread} />
                  ))}
                  {ungrouped.map((pos) => (
                    <TableRow key={pos.conId || pos.symbol}>
                      <TableCell>
                        <div className="pl-5">
                          <TickerHoverCard symbol={pos.underlying || pos.symbol}>
                            <Link
                              to={`/tickers/${pos.underlying || pos.symbol}`}
                              className="font-medium hover:text-primary hover:underline"
                            >
                              {pos.underlying}
                            </Link>
                          </TickerHoverCard>
                          <span className="text-muted-foreground ml-2 text-sm">
                            {pos.right === "P" ? "Put" : "Call"} {pos.strike}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={pos.right === "P" ? "danger" : "success"}>
                          {pos.right === "P" ? "PUT" : "CALL"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{pos.expiry}</TableCell>
                      <TableCell className="text-right tabular-nums">{pos.position}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(pos.avgCost)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pos.marketValue != null ? formatCurrency(pos.marketValue) : "—"}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-medium ${
                        pos.unrealizedPnl == null ? "text-muted-foreground"
                          : pos.unrealizedPnl >= 0 ? "text-green-600" : "text-red-600"
                      }`}>
                        {pos.unrealizedPnl != null ? formatCurrency(pos.unrealizedPnl) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })()}

      {/* Positions Table */}
      <Card>
        <CardContent className="pt-4">
          {filteredPositions.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {positions.length === 0
                ? "No positions found. Make sure TWS is connected."
                : "No positions match the current filters."}
            </p>
          ) : showGroupedView ? (
            <GroupedPositionsTable
              positions={filteredPositions}
              allocationData={allocationData}
              netLiquidation={netLiquidation}
              includeOptions={dashboardSettings.includeOptions}
              onSymbolClick={setChartSymbol}
              getSparkline={getPositionSparkline}
              expandedGroups={expandedGroups}
              onToggleGroup={handleToggleGroup}
            />
          ) : (
            <PositionTable
              positions={filteredPositions}
              assetClasses={assetClasses}
              netLiquidation={netLiquidation}
              assigningKey={assigning}
              onAssign={handleAssign}
              onSymbolClick={setChartSymbol}
              getSparkline={getPositionSparkline}
            />
          )}
        </CardContent>
      </Card>

      <ChartModal
        symbol={chartSymbol}
        open={!!chartSymbol}
        onClose={() => setChartSymbol(null)}
      />
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

function SpreadPositionRow({ spread }: { spread: PositionSpreadGroup }) {
  const [expanded, setExpanded] = useState(false);
  const badge = spreadTypeBadgeProps(spread.type);
  const displayName = formatLiveSpreadName(spread.type, spread.underlying, spread.legs);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell>
          <div className="flex items-center gap-1.5">
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            }
            <TickerHoverCard symbol={spread.underlying}>
              <Link
                to={`/tickers/${spread.underlying}`}
                className="font-medium hover:text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {displayName}
              </Link>
            </TickerHoverCard>
          </div>
        </TableCell>
        <TableCell>
          <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${badge.className}`}>
            {badge.label}
          </span>
        </TableCell>
        <TableCell className="text-muted-foreground">{spread.expiry}</TableCell>
        <TableCell className="text-right tabular-nums">{spread.quantity}</TableCell>
        <TableCell className="text-right tabular-nums">{formatCurrency(spread.totalAvgCost)}</TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCurrency(spread.totalMarketValue)}
        </TableCell>
        <TableCell className={`text-right tabular-nums font-medium ${
          spread.totalPnl == null ? "text-muted-foreground"
            : spread.totalPnl >= 0 ? "text-green-600" : "text-red-600"
        }`}>
          {spread.totalPnl != null ? formatCurrency(spread.totalPnl) : "—"}
        </TableCell>
      </TableRow>
      {expanded && spread.legs.map((leg) => (
        <TableRow key={leg.conId || leg.symbol} className="bg-muted/30">
          <TableCell className="pl-9 text-sm text-muted-foreground">
            {leg.position < 0 ? "Short" : "Long"} {leg.right === "P" ? "Put" : "Call"} {leg.strike}
          </TableCell>
          <TableCell>
            <Badge variant={leg.right === "P" ? "danger" : "success"} className="text-[10px]">
              {leg.right === "P" ? "PUT" : "CALL"}
            </Badge>
          </TableCell>
          <TableCell className="text-muted-foreground text-xs">{leg.expiry}</TableCell>
          <TableCell className="text-right tabular-nums text-xs">{leg.position}</TableCell>
          <TableCell className="text-right tabular-nums text-xs">{formatCurrency(leg.avgCost)}</TableCell>
          <TableCell className="text-right tabular-nums text-xs">
            {leg.marketValue != null ? formatCurrency(leg.marketValue) : "—"}
          </TableCell>
          <TableCell className={`text-right tabular-nums text-xs ${
            leg.unrealizedPnl == null ? "text-muted-foreground"
              : leg.unrealizedPnl >= 0 ? "text-green-600" : "text-red-600"
          }`}>
            {leg.unrealizedPnl != null ? formatCurrency(leg.unrealizedPnl) : "—"}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
