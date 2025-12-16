import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import type { Position, AssetClass, AllocationProfile, PositionSummary } from "@/lib/api";
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
import { RefreshCw, X, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ChartModal } from "@/components/ChartModal";

const STORAGE_KEY = "assup-positions-filters";

interface FilterState {
  assetClassId: string | null;
  includeOptions: boolean;
  optionsWeightMode: "notional" | "delta";
}

const DEFAULT_FILTERS: FilterState = {
  assetClassId: null,
  includeOptions: true,
  optionsWeightMode: "notional",
};

function loadFilters(): FilterState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migration from old showOptions to includeOptions
      if ("showOptions" in parsed && !("includeOptions" in parsed)) {
        parsed.includeOptions = parsed.showOptions;
        delete parsed.showOptions;
      }
      return { ...DEFAULT_FILTERS, ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_FILTERS;
}

function saveFilters(filters: FilterState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
}

export function PositionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [positions, setPositions] = useState<Position[]>([]);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [profile, setProfile] = useState<AllocationProfile | null>(null);
  const [summary, setSummary] = useState<PositionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

  // Initialize filters from URL params, falling back to localStorage
  const [filters, setFilters] = useState<FilterState>(() => {
    const urlAssetClassId = searchParams.get("assetClassId");
    if (urlAssetClassId) {
      return { ...DEFAULT_FILTERS, assetClassId: urlAssetClassId };
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

  // Format option contract details: "Jan 17 '25 $150" (without symbol and right)
  const formatOptionDetails = (pos: Position): string | null => {
    if (pos.secType !== "OPT") return null;

    const strike = pos.strike ? `$${pos.strike}` : "";

    // Format expiry: "20250117" -> "Jan 17 '25"
    let expiryStr = "";
    if (pos.expiry && pos.expiry.length === 8) {
      const year = pos.expiry.slice(2, 4);
      const month = parseInt(pos.expiry.slice(4, 6), 10);
      const day = parseInt(pos.expiry.slice(6, 8), 10);
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      expiryStr = `${months[month - 1]} ${day} '${year}`;
    }

    const parts = [expiryStr, strike].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : null;
  };

  // Get display symbol (underlying for options)
  const getDisplaySymbol = (pos: Position): string => {
    return pos.underlying || pos.symbol;
  };

  // Apply filters
  const filteredPositions = positions.filter((p) => {
    // Filter by options
    if (!filters.includeOptions && p.secType === "OPT") {
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

  // Helper to get position exposure (notional/delta for options, market value for stocks)
  const getPositionExposure = (p: Position): number => {
    if (p.secType === "OPT" && p.notionalValue !== undefined) {
      const isShort = p.position < 0;
      const isPut = p.right === "P";

      // Calculate notional exposure based on option type
      let notionalExposure = 0;
      if (isPut) {
        notionalExposure = isShort ? p.notionalValue : -p.notionalValue;
      } else {
        // Calls
        notionalExposure = isShort ? -p.notionalValue : p.notionalValue;
      }

      if (filters.optionsWeightMode === "delta") {
        // Delta-weighted: use 0.5 as ATM assumption
        return notionalExposure * 0.5;
      }
      return notionalExposure;
    }
    return p.marketValue ?? 0;
  };

  // Get account values
  const netLiquidation = summary?.account.netLiquidation ?? 0;
  const cashValue = summary?.account.cashValue ?? 0;

  // Calculate totals (from filtered positions)
  const hasAnyMarketValue = filteredPositions.some((p) => p.marketValue !== null);
  const positionsMarketValue = filteredPositions.reduce(
    (sum, p) => sum + (p.marketValue ?? 0),
    0
  );
  // Include cash in total market value when showing all positions
  const showCash = !filters.assetClassId || filters.assetClassId === "all";
  const totalMarketValue = positionsMarketValue + (showCash ? cashValue : 0);

  const totalExposure = filteredPositions.reduce(
    (sum, p) => sum + getPositionExposure(p),
    0
  );
  const totalPnl = filteredPositions.reduce(
    (sum, p) => sum + (p.unrealizedPnl ?? 0),
    0
  );
  const targetPercentage = useMemo(() => {
    if (!profile || !filters.assetClassId || filters.assetClassId === "all" || filters.assetClassId === "unassigned") {
      return null;
    }
    const target = profile.targets.find((t) => t.assetClassId === filters.assetClassId);
    return target?.targetPercentage ?? null;
  }, [profile, filters.assetClassId]);

  const targetValue = targetPercentage !== null ? (targetPercentage / 100) * netLiquidation : null;
  const diffToTarget = targetValue !== null ? totalExposure - targetValue : null;

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
              id="include-options"
              checked={filters.includeOptions}
              onCheckedChange={(checked) => setFilters({ ...filters, includeOptions: checked })}
            />
            <Label htmlFor="include-options" className="text-sm cursor-pointer">
              Include Options {optionsCount > 0 && `(${optionsCount})`}
            </Label>
          </div>

          {filters.includeOptions && (
            <Select
              value={filters.optionsWeightMode}
              onValueChange={(v: "notional" | "delta") =>
                setFilters({ ...filters, optionsWeightMode: v })
              }
            >
              <SelectTrigger className="w-36 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="notional">Notional</SelectItem>
                <SelectItem value="delta">Delta-weighted</SelectItem>
              </SelectContent>
            </Select>
          )}

          {(filters.assetClassId || !filters.includeOptions) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => setFilters({ ...DEFAULT_FILTERS })}
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Market Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasAnyMarketValue ? (
              <div className="text-2xl font-bold">{formatCurrency(totalMarketValue)}</div>
            ) : (
              <div className="text-2xl font-bold text-muted-foreground">N/A</div>
            )}
            {totalExposure !== totalMarketValue && (
              <p className="text-xs text-muted-foreground">
                Stocks: {formatCurrency(positionsMarketValue)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unrealized P&L
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasAnyMarketValue ? (
              <div className={`text-2xl font-bold ${totalPnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                {totalPnl >= 0 ? "+" : ""}{formatCurrency(totalPnl)}
              </div>
            ) : (
              <div className="text-2xl font-bold text-muted-foreground">N/A</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Target Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            {targetValue !== null ? (
              <>
                <div className="text-2xl font-bold">{formatCurrency(targetValue)}</div>
                <p className="text-xs text-muted-foreground">
                  {targetPercentage?.toFixed(1)}% of {formatCurrency(netLiquidation)}
                </p>
              </>
            ) : (
              <div className="text-2xl font-bold text-muted-foreground">—</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Action
            </CardTitle>
          </CardHeader>
          <CardContent>
            {diffToTarget !== null && diffToTarget < -1 && filters.assetClassId ? (
              <Badge variant="success" asChild className="text-base px-3 py-1">
                <Link to={`/scanner?assetClassId=${filters.assetClassId}`}>
                  BUY {formatCurrency(Math.abs(diffToTarget))}
                </Link>
              </Badge>
            ) : diffToTarget !== null && diffToTarget > 1 && filters.assetClassId ? (
              <Badge variant="danger" asChild className="text-base px-3 py-1">
                <Link to={`/scanner?assetClassId=${filters.assetClassId}`}>
                  SELL {formatCurrency(diffToTarget)}
                </Link>
              </Badge>
            ) : diffToTarget !== null ? (
              <div className="text-2xl font-bold text-muted-foreground">On target</div>
            ) : (
              <div className="text-2xl font-bold text-muted-foreground">—</div>
            )}
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
                  <TableHead>Name</TableHead>
                  <TableHead className="w-24">30D</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Cost Basis</TableHead>
                  <TableHead className="text-right">Mkt Value</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      Exposure
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground/70 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            <div className="space-y-1">
                              <p className="font-medium">Stocks: Market Value</p>
                              <p className="font-medium">Options: Strike × Qty × 100</p>
                              <p>• Short PUT: +exposure (may buy stock)</p>
                              <p>• Long PUT: −exposure (hedge)</p>
                              <p>• Short CALL: −exposure (may sell stock)</p>
                              <p>• Long CALL: +exposure (bullish)</p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </span>
                  </TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                  <TableHead>Assign To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unassigned.map((pos) => {
                  const key = `${pos.symbol}:${pos.secType}`;
                  const exposure = getPositionExposure(pos);
                  const sparkline = getPositionSparkline(pos);
                  const optionDetails = formatOptionDetails(pos);
                  return (
                    <TableRow key={key}>
                      <TableCell>
                        <button
                          className="font-medium hover:text-primary hover:underline cursor-pointer text-left"
                          onClick={() => setChartSymbol(getDisplaySymbol(pos))}
                        >
                          {getDisplaySymbol(pos)}
                        </button>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {optionDetails || "—"}
                      </TableCell>
                      <TableCell className="w-24">
                        <Sparkline
                          data={sparkline.data}
                          loading={sparkline.loading}
                          error={sparkline.error}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline">{pos.secType}</Badge>
                          {pos.secType === "OPT" && pos.right && (
                            <Badge variant={pos.right === "P" ? "danger" : "success"} className="text-xs">
                              {pos.right === "P" ? "PUT" : "CALL"}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(pos.position)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(pos.costBasis)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {pos.marketValue !== null ? formatCurrency(pos.marketValue) : <span className="text-muted-foreground">N/A</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(exposure)}
                      </TableCell>
                      <TableCell className={`text-right font-mono ${pos.unrealizedPnl !== null && pos.unrealizedPnl >= 0 ? "text-green-600" : pos.unrealizedPnl !== null ? "text-red-600" : ""}`}>
                        {pos.unrealizedPnl !== null ? (
                          <>{pos.unrealizedPnl >= 0 ? "+" : ""}{formatCurrency(pos.unrealizedPnl)}</>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
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
                  <TableHead>Name</TableHead>
                  <TableHead className="w-24">30D</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Asset Class</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Cost Basis</TableHead>
                  <TableHead className="text-right">Mkt Value</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      Exposure
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground/70 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            <div className="space-y-1">
                              <p className="font-medium">Stocks: Market Value</p>
                              <p className="font-medium">Options: Strike × Qty × 100</p>
                              <p>• Short PUT: +exposure (may buy stock)</p>
                              <p>• Long PUT: −exposure (hedge)</p>
                              <p>• Short CALL: −exposure (may sell stock)</p>
                              <p>• Long CALL: +exposure (bullish)</p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </span>
                  </TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                  <TableHead className="text-right">% of Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPositions.map((pos) => {
                  const key = `${pos.symbol}:${pos.secType}`;
                  const exposure = getPositionExposure(pos);
                  // % of Total: options use notional/netLiq, stocks use marketValue/netLiq
                  const pctValue = pos.secType === "OPT" ? exposure : (pos.marketValue ?? 0);
                  const pct = netLiquidation > 0 ? (pctValue / netLiquidation) * 100 : null;
                  const sparkline = getPositionSparkline(pos);
                  const optionDetails = formatOptionDetails(pos);
                  return (
                    <TableRow key={key}>
                      <TableCell>
                        <button
                          className="font-medium hover:text-primary hover:underline cursor-pointer text-left"
                          onClick={() => setChartSymbol(getDisplaySymbol(pos))}
                        >
                          {getDisplaySymbol(pos)}
                        </button>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {optionDetails || "—"}
                      </TableCell>
                      <TableCell className="w-24">
                        <Sparkline
                          data={sparkline.data}
                          loading={sparkline.loading}
                          error={sparkline.error}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline">{pos.secType}</Badge>
                          {pos.secType === "OPT" && pos.right && (
                            <Badge variant={pos.right === "P" ? "danger" : "success"} className="text-xs">
                              {pos.right === "P" ? "PUT" : "CALL"}
                            </Badge>
                          )}
                        </div>
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
                        {formatCurrency(pos.costBasis)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {pos.marketValue !== null ? formatCurrency(pos.marketValue) : <span className="text-muted-foreground">N/A</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(exposure)}
                      </TableCell>
                      <TableCell className={`text-right font-mono ${pos.unrealizedPnl !== null && pos.unrealizedPnl >= 0 ? "text-green-600" : pos.unrealizedPnl !== null ? "text-red-600" : ""}`}>
                        {pos.unrealizedPnl !== null ? (
                          <>{pos.unrealizedPnl >= 0 ? "+" : ""}{formatCurrency(pos.unrealizedPnl)}</>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {pct !== null ? `${pct.toFixed(1)}%` : <span className="text-muted-foreground">N/A</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* Cash row - always last */}
                {showCash && cashValue !== 0 && (
                  <TableRow>
                    <TableCell className="font-medium">Cash</TableCell>
                    <TableCell className="text-muted-foreground text-sm">—</TableCell>
                    <TableCell className="w-24">
                      <Sparkline
                        data={[{ date: "1", close: 1 }, { date: "2", close: 1 }]}
                        loading={false}
                        error={false}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">CASH</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">Cash</span>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(Math.round(cashValue))}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(1)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(cashValue)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(cashValue)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-green-600">
                      {formatCurrency(0)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {netLiquidation > 0 ? `${((cashValue / netLiquidation) * 100).toFixed(1)}%` : "—"}
                    </TableCell>
                  </TableRow>
                )}
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
