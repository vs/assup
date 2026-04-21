import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { api } from "@/api";
import type { Position, AssetClass, AllocationProfile, PositionSummary } from "@assup/shared";
import { calculatePositionExposure } from "@assup/shared";
import { useAllocationUpdates } from "@/hooks/useSSE";
import { useSparklines } from "@/hooks/useSparklines";
import { usePositionFilters } from "@/hooks/usePositionFilters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { useTickerProfileContext } from "@/components/common/TickerProfileProvider";
import { PositionFilters, PositionSummaryCards, PositionTable } from "@/components/positions";
import { ChartModal } from "@/components/ChartModal";

export function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [profile, setProfile] = useState<AllocationProfile | null>(null);
  const [summary, setSummary] = useState<PositionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

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

      // Load active allocation profile
      try {
        const profileData = await api.allocationProfiles.getActive();
        setProfile(profileData);
      } catch {
        setProfile(null);
      }

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

  // Apply filters
  const filteredPositions = useMemo(() => {
    return positions.filter((p) => {
      if (!filters.includeOptions && p.secType === "OPT") return false;
      if (filters.assetClassId && filters.assetClassId !== "all") {
        if (filters.assetClassId === "unassigned") return !p.assetClassId;
        return p.assetClassId === filters.assetClassId;
      }
      return true;
    });
  }, [positions, filters]);

  // Calculate summary values
  const netLiquidation = summary?.account.netLiquidation ?? 0;
  const hasAnyMarketValue = filteredPositions.some((p) => p.marketValue !== null);
  const isAllClasses = !filters.assetClassId || filters.assetClassId === "all";

  const stocksMarketValue = useMemo(() => {
    return filteredPositions
      .filter((p) => p.secType !== "CASH" && p.secType !== "OPT")
      .reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
  }, [filteredPositions]);

  const totalExposure = useMemo(() => {
    return filteredPositions.reduce((sum, p) => sum + calculatePositionExposure(p), 0);
  }, [filteredPositions]);

  const totalPnl = useMemo(() => {
    return filteredPositions.reduce((sum, p) => sum + (p.unrealizedPnl ?? 0), 0);
  }, [filteredPositions]);

  const targetPercentage = useMemo(() => {
    if (!profile || !filters.assetClassId || filters.assetClassId === "all" || filters.assetClassId === "unassigned") {
      return null;
    }
    const target = profile.targets.find((t) => t.assetClassId === filters.assetClassId);
    return target?.targetPercentage ?? null;
  }, [profile, filters.assetClassId]);

  const targetValue = targetPercentage !== null ? (targetPercentage / 100) * netLiquidation : null;
  const diffToTarget = targetValue !== null ? totalExposure - targetValue : null;
  const optionsCount = positions.filter((p) => p.secType === "OPT").length;

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

  // Table title
  const tableTitle = useMemo(() => {
    if (!filters.assetClassId || filters.assetClassId === "all") return "All Positions";
    if (filters.assetClassId === "unassigned") return "Unassigned Positions";
    return `${assetClasses.find((ac) => ac.id === filters.assetClassId)?.name || "Filtered"} Positions`;
  }, [filters.assetClassId, assetClasses]);

  if (loading && positions.length === 0) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Positions</h1>
          <p className="text-muted-foreground">
            View and assign your positions to asset classes.
          </p>
        </div>
        <PositionFilters
          filters={filters}
          onFiltersChange={setFilters}
          assetClasses={assetClasses}
          optionsCount={optionsCount}
          loading={loading}
          onRefresh={loadData}
        />
      </div>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      <PositionSummaryCards
        hasAnyMarketValue={hasAnyMarketValue}
        isAllClasses={isAllClasses}
        netLiquidation={netLiquidation}
        totalExposure={totalExposure}
        stocksMarketValue={stocksMarketValue}
        totalPnl={totalPnl}
        targetValue={targetValue}
        targetPercentage={targetPercentage}
        diffToTarget={diffToTarget}
        assetClassId={filters.assetClassId}
      />

      {/* All Positions */}
      <Card>
        <CardHeader>
          <CardTitle>{tableTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredPositions.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {positions.length === 0
                ? "No positions found. Make sure TWS is connected."
                : "No positions match the current filters."}
            </p>
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
