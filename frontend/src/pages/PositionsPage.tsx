import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Position, AssetClass } from "@/lib/api";
import { useAllocationUpdates } from "@/hooks/useSSE";
import { useSparklines } from "@/hooks/useSparklines";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AssetClassSelect } from "@/components/common/AssetClassSelect";
import { Sparkline } from "@/components/Sparkline";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ChartModal } from "@/components/ChartModal";

const STORAGE_KEY = "assup-positions-filters";

interface FilterState {
  assetClassId: string | null;
  showOptions: boolean;
}

function loadFilters(): FilterState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return { assetClassId: null, showOptions: true };
}

function saveFilters(filters: FilterState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
}

export function PositionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [positions, setPositions] = useState<Position[]>([]);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

  // Initialize filters from URL params, falling back to localStorage
  const [filters, setFilters] = useState<FilterState>(() => {
    const urlAssetClassId = searchParams.get("assetClassId");
    if (urlAssetClassId) {
      return { assetClassId: urlAssetClassId, showOptions: true };
    }
    return loadFilters();
  });

  // Subscribe to real-time allocation updates
  const handleAllocationUpdate = useCallback(() => {
    loadData();
  }, []);
  useAllocationUpdates(handleAllocationUpdate);

  useEffect(() => {
    loadData();
  }, []);

  // Sync filters with localStorage and URL
  useEffect(() => {
    saveFilters(filters);
    // Update URL params when filter changes
    if (filters.assetClassId && filters.assetClassId !== "all") {
      setSearchParams({ assetClassId: filters.assetClassId }, { replace: true });
    } else {
      // Remove the param when cleared
      if (searchParams.has("assetClassId")) {
        setSearchParams({}, { replace: true });
      }
    }
  }, [filters, searchParams, setSearchParams]);

  async function loadData() {
    try {
      setLoading(true);
      const [posData, acData] = await Promise.all([
        api.positions.list(),
        api.assetClasses.list(),
      ]);
      setPositions(posData);
      setAssetClasses(acData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load positions");
    } finally {
      setLoading(false);
    }
  }

  async function handleAssign(position: Position, assetClassId: string | null) {
    const key = `${position.symbol}:${position.secType}`;
    setAssigning(key);

    try {
      if (assetClassId) {
        await api.securityAssignments.create({
          symbol: position.symbol,
          conId: position.conId,
          secType: position.secType,
          assetClassId,
          source: "position",
        });
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign security");
    } finally {
      setAssigning(null);
    }
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(value);

  const formatNumber = (value: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);

  // Apply filters
  const filteredPositions = positions.filter((p) => {
    // Filter by options
    if (!filters.showOptions && p.secType === "OPT") {
      return false;
    }
    // Filter by asset class
    if (filters.assetClassId && filters.assetClassId !== "all") {
      if (filters.assetClassId === "unassigned") {
        return !p.assetClassId;
      }
      return p.assetClassId === filters.assetClassId;
    }
    return true;
  });

  // Group positions by asset class
  const unassigned = filteredPositions.filter((p) => !p.assetClassId);
  const assigned = filteredPositions.filter((p) => p.assetClassId);

  // Calculate totals (from filtered positions)
  const totalValue = filteredPositions.reduce(
    (sum, p) => sum + Math.abs(p.position * p.avgCost),
    0
  );

  // Count options positions
  const optionsCount = positions.filter((p) => p.secType === "OPT").length;

  // Sparklines - use underlying for options
  const sparklineSymbols = useMemo(() => {
    const uniqueSymbols = new Set<string>();
    for (const pos of filteredPositions) {
      const symbol = pos.underlying || pos.symbol;
      uniqueSymbols.add(symbol);
    }
    return Array.from(uniqueSymbols);
  }, [filteredPositions]);
  const { getSparklineState } = useSparklines(sparklineSymbols);

  const getPositionSparkline = (pos: Position) => {
    const symbol = pos.underlying || pos.symbol;
    return getSparklineState(symbol);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading positions...</p>
      </div>
    );
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
        <div className="flex flex-wrap items-center gap-4">
          <Select
            value={filters.assetClassId || "all"}
            onValueChange={(v) => setFilters({ ...filters, assetClassId: v === "all" ? null : v })}
          >
            <SelectTrigger className="w-48 h-8">
              <SelectValue placeholder="All classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              <SelectItem value="unassigned">Unassigned only</SelectItem>
              {assetClasses.map((ac) => (
                <SelectItem key={ac.id} value={ac.id}>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: ac.color }}
                    />
                    {ac.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Switch
              id="show-options"
              checked={filters.showOptions}
              onCheckedChange={(checked) => setFilters({ ...filters, showOptions: checked })}
            />
            <Label htmlFor="show-options" className="text-sm cursor-pointer">
              Show Options {optionsCount > 0 && `(${optionsCount})`}
            </Label>
          </div>

          {(filters.assetClassId || !filters.showOptions) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => setFilters({ assetClassId: null, showOptions: true })}
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Positions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredPositions.length}</div>
            {filteredPositions.length !== positions.length && (
              <p className="text-xs text-muted-foreground">of {positions.length} total</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Assigned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{assigned.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unassigned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{unassigned.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Unassigned Positions */}
      {unassigned.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Unassigned Positions
              <Badge variant="secondary">{unassigned.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="w-24">30D</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Avg Cost</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Assign To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unassigned.map((pos) => {
                  const key = `${pos.symbol}:${pos.secType}`;
                  const value = Math.abs(pos.position * pos.avgCost);
                  const sparkline = getPositionSparkline(pos);
                  return (
                    <TableRow key={key}>
                      <TableCell>
                        <button
                          className="font-medium hover:text-primary hover:underline cursor-pointer text-left"
                          onClick={() => setChartSymbol(pos.symbol)}
                        >
                          {pos.symbol}
                        </button>
                      </TableCell>
                      <TableCell className="w-24">
                        <Sparkline
                          data={sparkline.data}
                          loading={sparkline.loading}
                          error={sparkline.error}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{pos.secType}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(pos.position)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(pos.avgCost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(value)}
                      </TableCell>
                      <TableCell>
                        <AssetClassSelect
                          disabled={assigning === key}
                          onValueChange={(v) => handleAssign(pos, v)}
                          assetClasses={assetClasses}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* All Positions */}
      <Card>
        <CardHeader>
          <CardTitle>
            {filters.assetClassId && filters.assetClassId !== "all"
              ? filters.assetClassId === "unassigned"
                ? "Unassigned Positions"
                : `${assetClasses.find((ac) => ac.id === filters.assetClassId)?.name || "Filtered"} Positions`
              : "All Positions"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredPositions.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {positions.length === 0
                ? "No positions found. Make sure TWS is connected."
                : "No positions match the current filters."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="w-24">30D</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Asset Class</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Avg Cost</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPositions.map((pos) => {
                  const key = `${pos.symbol}:${pos.secType}`;
                  const value = Math.abs(pos.position * pos.avgCost);
                  const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
                  const sparkline = getPositionSparkline(pos);
                  return (
                    <TableRow key={key}>
                      <TableCell>
                        <button
                          className="font-medium hover:text-primary hover:underline cursor-pointer text-left"
                          onClick={() => setChartSymbol(pos.symbol)}
                        >
                          {pos.symbol}
                        </button>
                      </TableCell>
                      <TableCell className="w-24">
                        <Sparkline
                          data={sparkline.data}
                          loading={sparkline.loading}
                          error={sparkline.error}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{pos.secType}</Badge>
                      </TableCell>
                      <TableCell>
                        <AssetClassSelect
                          value={pos.assetClassId}
                          disabled={assigning === key}
                          onValueChange={(v) => handleAssign(pos, v)}
                          assetClasses={assetClasses}
                          placeholder="Assign..."
                          className="w-44"
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(pos.position)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(pos.avgCost)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(value)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {pct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
