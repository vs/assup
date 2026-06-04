import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { api } from "@/api";
import { settingsApi } from "@/api/settings";
import type { Position, AssetClass, AllocationProfile, PositionSummary } from "@assup/shared";
import { calculatePositionExposure, formatCurrency } from "@assup/shared";
import { useAllocationUpdates } from "@/hooks/useSSE";
import { useSparklines } from "@/hooks/useSparklines";
import { usePositionFilters } from "@/hooks/usePositionFilters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { useTickerProfileContext } from "@/components/common/TickerProfileProvider";
import { PositionFilters, PositionSummaryCards, PositionTable } from "@/components/positions";
import { ChartModal } from "@/components/ChartModal";

const DEFAULT_SPREAD_SYMBOLS = ["SPX", "XSP", "RUT"];

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
      if (filters.assetClassId && filters.assetClassId !== "all") {
        if (filters.assetClassId === "unassigned") return !p.assetClassId;
        return p.assetClassId === filters.assetClassId;
      }
      return true;
    });
  }, [positions, filters, spreadSymbols]);

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
  const optionsCount = positions.filter((p) =>
    p.secType === "OPT" && !(p.underlying && spreadSymbols.has(p.underlying))
  ).length;

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

      {/* Spread Positions */}
      {spreadPositions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardTitle>Spread Positions</CardTitle>
              <Badge variant="secondary">{spreadPositions.length} legs</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">Strike</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Avg Cost</TableHead>
                  <TableHead className="text-right">Market Value</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spreadPositions.map((pos) => (
                  <TableRow key={pos.conId || pos.symbol}>
                    <TableCell className="font-medium">{pos.underlying}</TableCell>
                    <TableCell>
                      <Badge variant={pos.right === "P" ? "danger" : "success"}>
                        {pos.right === "P" ? "PUT" : "CALL"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {pos.expiry}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pos.strike}</TableCell>
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
      )}

      <ChartModal
        symbol={chartSymbol}
        open={!!chartSymbol}
        onClose={() => setChartSymbol(null)}
      />
    </div>
  );
}
