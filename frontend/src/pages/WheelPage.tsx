import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/api";
import type {
  WheelListResponse,
  WheelTickerSummary,
  WheelSuggestion,
  WheelMatchedTrade,
  SparklinePoint,
} from "@assup/shared";
import { formatCurrency } from "@assup/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PageHeader,
  ErrorAlert,
  PageLoadingSkeleton,
} from "@/components/common";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";
import { useTickerProfileContext } from "@/components/common/TickerProfileProvider";
import { Sparkline } from "@/components/Sparkline";
import { ChartModal } from "@/components/ChartModal";
import { useSparklines } from "@/hooks";
import { Plus, X, ChevronDown, ChevronUp } from "lucide-react";
import { scannerApi } from "@/api/scanner";
import type { ScannerCriteria } from "@assup/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const CACHE_KEYS = {
  tickers: "wheel-tickers-cache",
  suggestions: "wheel-suggestions-cache",
  detail: (symbol: string) => `wheel-detail-${symbol}`,
};

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* localStorage unavailable */ }
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format "2026-03-28" to "Mar28" */
function formatShortExpiry(expiry: string): string {
  const [, m, d] = expiry.split("-");
  return `${SHORT_MONTHS[parseInt(m, 10) - 1]}${parseInt(d, 10)}`;
}

export function WheelPage() {
  const [data, setData] = useState<WheelListResponse | null>(
    () => readCache<WheelListResponse>(CACHE_KEYS.tickers)
  );
  const [suggestions, setSuggestions] = useState<WheelSuggestion[]>(
    () => readCache<WheelSuggestion[]>(CACHE_KEYS.suggestions) ?? []
  );
  const [loading, setLoading] = useState(
    () => readCache(CACHE_KEYS.tickers) === null
  );
  const [error, setError] = useState<string | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

  const sparklineSymbols = useMemo(
    () => data?.tickers.map((t) => t.symbol) ?? [],
    [data?.tickers]
  );
  const { getSparklineState } = useSparklines(sparklineSymbols);

  const { prefetch } = useTickerProfileContext();

  useEffect(() => {
    if (data?.tickers?.length) {
      prefetch(data.tickers.map((t: { symbol: string }) => t.symbol));
    }
  }, [data?.tickers, prefetch]);

  const loadData = useCallback(async () => {
    try {
      setLoading((prev) => prev && readCache(CACHE_KEYS.tickers) === null);
      const wheelData = await api.wheel.list({ includeSuggestions: false });
      setData(wheelData);
      writeCache(CACHE_KEYS.tickers, wheelData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      return;
    } finally {
      setLoading(false);
    }

    // Load suggestions separately to avoid blocking initial render
    api.wheel
      .suggestions()
      .then((res) => {
        setSuggestions(res.suggestions);
        writeCache(CACHE_KEYS.suggestions, res.suggestions);
      })
      .catch((err) => console.error("Failed to load wheel suggestions:", err));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddTicker = async () => {
    if (!newSymbol.trim()) return;
    try {
      await api.wheel.add(newSymbol.trim());
      setNewSymbol("");
      setAddDialogOpen(false);
      localStorage.removeItem(CACHE_KEYS.tickers);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add ticker");
    }
  };

  const handleRemoveTicker = async (symbol: string) => {
    if (!confirm(`Remove ${symbol} from wheel tracking?`)) return;
    try {
      await api.wheel.remove(symbol);
      localStorage.removeItem(CACHE_KEYS.tickers);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove ticker");
    }
  };

  const handleAddSuggestion = async (symbol: string) => {
    try {
      await api.wheel.add(symbol);
      localStorage.removeItem(CACHE_KEYS.tickers);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add ticker");
    }
  };

  const handleDismissSuggestion = async (symbol: string) => {
    try {
      await api.wheel.dismissSuggestion(symbol);
      setSuggestions((prev) => {
        const updated = prev.filter((s) => s.symbol !== symbol);
        writeCache(CACHE_KEYS.suggestions, updated);
        return updated;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss suggestion");
    }
  };

  if (loading && !data) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wheel"
        subtitle="Track your wheel strategy performance"
        loading={loading}
        onRefresh={loadData}
        actions={
          <div className="flex items-center gap-2">
            {suggestions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Badge variant="secondary" className="mr-2">
                      {suggestions.length}
                    </Badge>
                    Suggestions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-96 max-h-80 overflow-y-auto">
                  {suggestions.map((s, index) => {
                    // Check if this is the first non-active item after active items
                    const showDivider = index > 0 &&
                      suggestions[index - 1].hasActivePosition &&
                      !s.hasActivePosition;

                    return (
                      <div key={s.symbol}>
                        {showDivider && (
                          <div className="border-t border-border my-1" />
                        )}
                        <DropdownMenuItem className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            {s.hasActivePosition && (
                              <span className="w-2 h-2 rounded-full bg-green-500" />
                            )}
                            <span className={`font-medium ${!s.hasActivePosition ? "ml-4" : ""}`}>
                              {s.symbol}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {s.putCount}P / {s.callCount}C
                            </span>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.preventDefault();
                                handleAddSuggestion(s.symbol);
                              }}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.preventDefault();
                                handleDismissSuggestion(s.symbol);
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </DropdownMenuItem>
                      </div>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Ticker
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Ticker to Wheel Tracking</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="symbol">Symbol</Label>
                    <Input
                      id="symbol"
                      value={newSymbol}
                      onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                      placeholder="AAPL"
                    />
                  </div>
                  <Button onClick={handleAddTicker} className="w-full">
                    Add
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {/* Aggregate Metrics */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard
            label="Capital Deployed"
            value={formatCurrency(data.metrics.capitalDeployed)}
          />
          <MetricCard
            label="Realized P&L"
            value={(data.metrics.totalRealizedPnL >= 0 ? "+" : "") + formatCurrency(data.metrics.totalRealizedPnL)}
            className={data.metrics.totalRealizedPnL >= 0 ? "text-green-600" : "text-red-600"}
          />
          <MetricCard
            label="Unrealized P&L"
            value={(data.metrics.totalUnrealizedPnL >= 0 ? "+" : "") + formatCurrency(data.metrics.totalUnrealizedPnL)}
            className={data.metrics.totalUnrealizedPnL >= 0 ? "text-green-600" : "text-red-600"}
          />
          <MetricCard
            label="Yield"
            value={`${data.metrics.premiumYieldAnnualized.toFixed(1)}%`}
          />
          <MetricCard
            label="Active Wheels"
            value={data.metrics.activeWheels.toString()}
          />
          <MetricCard
            label="Completed Cycles"
            value={data.metrics.completedCycles.toString()}
          />
        </div>
      )}

      {/* Ticker Cards */}
      <div className="space-y-4 mt-4">
        {data?.tickers.map((ticker) => {
          const sparkline = getSparklineState(ticker.symbol);
          return (
            <WheelTickerCard
              key={ticker.symbol}
              ticker={ticker}
              isExpanded={expandedTicker === ticker.symbol}
              onToggle={() =>
                setExpandedTicker(
                  expandedTicker === ticker.symbol ? null : ticker.symbol
                )
              }
              onRemove={() => handleRemoveTicker(ticker.symbol)}
              sparklineData={sparkline.data}
              sparklineLoading={sparkline.loading}
              sparklineError={sparkline.error}
              onChartClick={() => setChartSymbol(ticker.symbol)}
            />
          );
        })}
        {data?.tickers.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No tickers tracked yet. Add a ticker or select from suggestions.
            </CardContent>
          </Card>
        )}
      </div>

      <ChartModal
        symbol={chartSymbol}
        open={chartSymbol !== null}
        onClose={() => setChartSymbol(null)}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold ${className || ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function WheelTickerCard({
  ticker,
  isExpanded,
  onToggle,
  onRemove,
  sparklineData,
  sparklineLoading,
  sparklineError,
  onChartClick,
}: {
  ticker: WheelTickerSummary;
  isExpanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  sparklineData: SparklinePoint[];
  sparklineLoading: boolean;
  sparklineError: boolean;
  onChartClick: () => void;
}) {
  const startScanJob = async (symbol: string, optionType: "PUT" | "CALL") => {
    const baseCriteria: ScannerCriteria = optionType === "PUT"
      ? {
          optionTypes: "PUT",
          minDaysToExpiry: 3,
          maxDaysToExpiry: 45,
          minDelta: 0,
          maxDelta: 0.35,
          minAnnualizedReturn: 5,
          minPremiumPercent: 0.2,
          putMinStrikePercent: 70,
          putMaxStrikePercent: 100,
          callMinStrikePercent: 100,
          callMaxStrikePercent: 125,
        }
      : {
          optionTypes: "CALL",
          minDaysToExpiry: 3,
          maxDaysToExpiry: 45,
          minDelta: 0,
          maxDelta: 0.35,
          minAnnualizedReturn: 5,
          minPremiumPercent: 0.2,
          putMinStrikePercent: 100,
          putMaxStrikePercent: 70,
          callMinStrikePercent: 100,
          callMaxStrikePercent: 130,
        };
    try {
      await scannerApi.jobs.create({
        criteria: { ...baseCriteria, specificSymbol: symbol },
      });
    } catch (err) {
      console.error("Failed to start scan job:", err);
    }
  };

  const phaseLabels: Record<string, string> = {
    csp_open: "CSP",
    holding_shares: "Shares",
    cc_open: "CC",
    idle: "Idle",
  };

  const phaseColors: Record<string, string> = {
    csp_open: "bg-yellow-100 text-yellow-800",
    holding_shares: "bg-blue-100 text-blue-800",
    cc_open: "bg-purple-100 text-purple-800",
    idle: "bg-gray-100 text-gray-800",
  };

  const isProfitable = ticker.currentPrice && ticker.currentPrice > ticker.adjustedCostBasis;

  return (
    <Card
      className={`${isProfitable ? "border-l-4 border-l-green-500" : ""}`}
      title={isProfitable ? "Price above cost basis" : undefined}
    >
      <CardHeader
        className="cursor-pointer hover:bg-muted/50"
        onClick={onToggle}
      >
        <div className="flex items-center">
          <div className="flex items-center gap-2 min-w-[200px] shrink-0">
            <CardTitle className="text-lg">
              <TickerHoverCard symbol={ticker.symbol}>
                <span className="cursor-default">{ticker.symbol}</span>
              </TickerHoverCard>
            </CardTitle>
            {ticker.activePhases && ticker.activePhases.length > 0 ? (
              <>
                {ticker.activePhases.includes("holding_shares") && ticker.shareQuantity > 0 && (
                  <Badge className={phaseColors.holding_shares}>
                    {ticker.shareQuantity} @ ${(ticker.positionAvgCost ?? ticker.adjustedCostBasis).toFixed(2)}
                  </Badge>
                )}
                {ticker.activePhases.includes("cc_open") && (
                  <Badge className={phaseColors.cc_open}>
                    CC
                    {ticker.activeOptions?.nearestCall && (
                      <> {formatShortExpiry(ticker.activeOptions.nearestCall.expiry)} ${ticker.activeOptions.nearestCall.strike}</>
                    )}
                    {(ticker.activeOptions?.totalCallContracts ?? 0) > 1 && (
                      <span className="ml-1 opacity-75">x{ticker.activeOptions!.totalCallContracts}</span>
                    )}
                  </Badge>
                )}
                {ticker.activePhases.includes("csp_open") && (
                  <Badge className={phaseColors.csp_open}>
                    CSP
                    {ticker.activeOptions?.nearestPut && (
                      <> {formatShortExpiry(ticker.activeOptions.nearestPut.expiry)} ${ticker.activeOptions.nearestPut.strike}</>
                    )}
                    {(ticker.activeOptions?.totalPutContracts ?? 0) > 1 && (
                      <span className="ml-1 opacity-75">x{ticker.activeOptions!.totalPutContracts}</span>
                    )}
                  </Badge>
                )}
              </>
            ) : (
              <Badge className={phaseColors[ticker.currentPhase]}>
                {phaseLabels[ticker.currentPhase]}
              </Badge>
            )}
          </div>
          <div className="mx-4" onClick={(e) => e.stopPropagation()}>
            <Sparkline
              data={sparklineData}
              loading={sparklineLoading}
              error={sparklineError}
              onChartClick={onChartClick}
            />
          </div>
          <div className="flex items-center justify-end gap-8 flex-1">
            {ticker.currentPrice && (
              <div className="text-right min-w-[70px]">
                <div className="text-sm text-muted-foreground">Price</div>
                <div className="font-semibold">${ticker.currentPrice.toFixed(2)}</div>
              </div>
            )}
            <div className="text-right min-w-[80px]">
              <div className="text-sm text-muted-foreground">Cost Basis</div>
              <div className="font-semibold">${ticker.adjustedCostBasis.toFixed(2)}</div>
            </div>
            <div className="text-right min-w-[120px]">
              <div className="text-sm text-muted-foreground">Realized</div>
              <div className={`font-semibold ${ticker.realizedPnL >= 0 ? "text-green-600" : "text-red-600"}`}>
                {ticker.realizedPnL >= 0 ? "+" : ""}{formatCurrency(ticker.realizedPnL)}
                {ticker.realizedPnLPercent !== null && (
                  <span className="text-xs ml-1">({ticker.realizedPnLPercent.toFixed(1)}%)</span>
                )}
              </div>
            </div>
            <div className="text-right min-w-[130px]">
              <div className="text-sm text-muted-foreground">Unrealized</div>
              <div className={`font-semibold ${ticker.unrealizedPnL >= 0 ? "text-green-600" : "text-red-600"}`}>
                {ticker.unrealizedPnL >= 0 ? "+" : ""}{formatCurrency(ticker.unrealizedPnL)}
                {ticker.unrealizedPnLPercent !== null && (
                  <span className="text-xs ml-1">({ticker.unrealizedPnLPercent.toFixed(1)}%)</span>
                )}
              </div>
            </div>
            <div className="text-right min-w-[80px]">
              <div className="text-sm text-muted-foreground">Cycles</div>
              <div className="font-semibold">
                {ticker.cycleCount} ({ticker.completedCycles} done)
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-6">
            <Button
              variant="ghost"
              size="sm"
              title="Scan puts"
              className="text-xs px-2"
              onClick={(e) => {
                e.stopPropagation();
                startScanJob(ticker.symbol, "PUT");
              }}
            >
              P
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Scan calls"
              className="text-xs px-2"
              onClick={(e) => {
                e.stopPropagation();
                startScanJob(ticker.symbol, "CALL");
              }}
            >
              C
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <X className="h-4 w-4" />
            </Button>
            {isExpanded ? (
              <ChevronUp className="h-5 w-5" />
            ) : (
              <ChevronDown className="h-5 w-5" />
            )}
          </div>
        </div>
      </CardHeader>
      {isExpanded && (
        <CardContent>
          <WheelTickerDetail symbol={ticker.symbol} />
        </CardContent>
      )}
    </Card>
  );
}

function WheelTickerDetail({ symbol }: { symbol: string }) {
  const cacheKey = CACHE_KEYS.detail(symbol);
  const [detail, setDetail] = useState<import("@assup/shared").WheelTickerDetail | null>(
    () => readCache<import("@assup/shared").WheelTickerDetail>(cacheKey)
  );
  const [loading, setLoading] = useState(() => readCache(cacheKey) === null);
  const [selectedCycleNumber, setSelectedCycleNumber] = useState<number | null>(null);
  const [showAllCycles, setShowAllCycles] = useState(false);

  useEffect(() => {
    api.wheel
      .detail(symbol)
      .then((data) => {
        setDetail(data);
        writeCache(cacheKey, data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [symbol, cacheKey]);

  if (loading) {
    return <div className="py-4 text-center text-muted-foreground">Loading...</div>;
  }

  if (!detail) {
    return <div className="py-4 text-center text-muted-foreground">No data</div>;
  }

  const INITIAL_CYCLE_LIMIT = 5;

  // Show last N cycles by default (always including in-progress ones)
  const allCycles = detail.cycles;
  const recentCycles = showAllCycles
    ? allCycles
    : allCycles.slice(-INITIAL_CYCLE_LIMIT);
  const hasOlderCycles = allCycles.length > INITIAL_CYCLE_LIMIT;

  // Default to the last cycle if none selected
  const selectedCycle = recentCycles.find((c) => c.cycleNumber === selectedCycleNumber)
    || recentCycles[recentCycles.length - 1];

  return (
    <div className="space-y-4">
      {/* Cycle Summary Cards */}
      <div className="flex gap-4 overflow-x-auto p-2">
        {hasOlderCycles && !showAllCycles && (
          <Card
            className="min-w-[120px] cursor-pointer transition-all hover:bg-muted/50 flex items-center justify-center border-dashed"
            onClick={() => setShowAllCycles(true)}
          >
            <CardContent className="pt-4 text-center">
              <div className="text-sm text-muted-foreground">
                {allCycles.length - recentCycles.length} more
                {allCycles.length - recentCycles.length === 1 ? " cycle" : " cycles"}
              </div>
            </CardContent>
          </Card>
        )}
        {recentCycles.map((cycle) => (
          <Card
            key={cycle.cycleNumber}
            className={`min-w-[220px] cursor-pointer transition-all ${
              cycle.status === "in_progress" ? "border-primary" : ""
            } ${
              selectedCycle?.cycleNumber === cycle.cycleNumber
                ? "ring-2 ring-primary ring-offset-2"
                : "hover:bg-muted/50"
            }`}
            onClick={() => setSelectedCycleNumber(cycle.cycleNumber)}
          >
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Cycle {cycle.cycleNumber}</span>
                <Badge variant={cycle.status === "in_progress" ? "default" : "secondary"}>
                  {cycle.status === "in_progress"
                    ? "In Progress"
                    : cycle.status === "called_away"
                    ? "Called Away"
                    : cycle.status === "expired_worthless"
                    ? "Expired"
                    : cycle.status === "closed"
                    ? "Closed"
                    : "Sold"}
                </Badge>
              </div>
              {/* Entry/Exit info */}
              <div className="text-xs space-y-1 mb-2">
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-muted-foreground">
                    {cycle.entryDescription} ({cycle.startDate})
                  </span>
                </div>
                {cycle.exitDescription ? (
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-muted-foreground">
                      {cycle.exitDescription} ({cycle.endDate})
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-muted-foreground">
                      Running...
                    </span>
                  </div>
                )}
              </div>
              <CycleSummaryMetrics cycle={cycle} />
              <div className="text-xs text-muted-foreground mt-2">
                {cycle.durationDays} days • {cycle.trades.length} trades
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Contract Lifecycles (for selected cycle) */}
      {selectedCycle && (
        <CycleTradesView cycle={selectedCycle} />
      )}

      {/* Messages for empty/filtered states */}
      {recentCycles.length === 0 && detail.cycles.length === 0 && (
        <div className="text-center text-muted-foreground py-4">
          No wheel cycles found. Sell a PUT or buy shares to start tracking.
        </div>
      )}
    </div>
  );
}

// Display cycle P&L metrics from the cycle's pre-calculated fields
function CycleSummaryMetrics({ cycle }: { cycle: import("@assup/shared").WheelCycle }) {
  const isCompleted = cycle.status !== "in_progress";

  if (isCompleted) {
    // Completed cycles: show just P&L with percentage
    return (
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-muted-foreground">P&L</div>
          <div className={`font-medium ${cycle.realizedPnL >= 0 ? "text-green-600" : "text-red-600"}`}>
            {cycle.realizedPnL >= 0 ? "+" : ""}{formatCurrency(cycle.realizedPnL)}
            {cycle.pnlPercent !== null && (
              <span className="text-xs ml-1">({cycle.pnlPercent.toFixed(1)}%)</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">ROC</div>
          <div className="font-medium">
            {cycle.roc.toFixed(1)}%
            <span className="text-xs text-muted-foreground ml-1">
              ({cycle.annualizedRoc.toFixed(0)}% ann.)
            </span>
          </div>
        </div>
      </div>
    );
  }

  // In-progress cycles: show Realized | Unrealized
  return (
    <div className="mt-2 space-y-2 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-muted-foreground">Realized</div>
          <div className={`font-medium ${cycle.realizedPnL >= 0 ? "text-green-600" : "text-red-600"}`}>
            {cycle.realizedPnL >= 0 ? "+" : ""}{formatCurrency(cycle.realizedPnL)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Unrealized</div>
          <div className={`font-medium ${(cycle.unrealizedPnL ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
            {(cycle.unrealizedPnL ?? 0) >= 0 ? "+" : ""}{formatCurrency(cycle.unrealizedPnL ?? 0)}
          </div>
        </div>
      </div>
      <div>
        <div className="text-muted-foreground">ROC</div>
        <div className="font-medium">
          {cycle.roc.toFixed(1)}%
          <span className="text-xs text-muted-foreground ml-1">
            ({cycle.annualizedRoc.toFixed(0)}% ann.)
          </span>
        </div>
      </div>
    </div>
  );
}

function MatchedTradeRow({ trade }: { trade: WheelMatchedTrade }) {
  // Format opening action: "Sell PUT $67 Jan30 @ $1.55" or "Buy 5 shares @ $90.72"
  const getOpenAction = () => {
    if (!trade.openLeg) return null;

    if (trade.type === "STOCK") {
      return {
        action: `Buy ${trade.openLeg.quantity} shares`,
        price: `@ $${trade.openLeg.price.toFixed(2)}`,
        date: trade.openLeg.date,
      };
    }

    // Option: extract strike and expiry from displayName
    const parts = trade.displayName.split(" ");
    if (parts.length >= 4) {
      const expiry = parts[1];
      const strike = parts[2];
      return {
        action: `${trade.openLeg.action} $${strike} ${expiry}`,
        price: `@ $${trade.openLeg.price.toFixed(2)}`,
        date: trade.openLeg.date,
      };
    }

    return {
      action: trade.openLeg.action,
      price: trade.openLeg.price > 0 ? `@ $${trade.openLeg.price.toFixed(2)}` : "",
      date: trade.openLeg.date,
    };
  };

  // Format closing action: "Bought back @ $0.78" or "Expired" or "Assigned"
  const getCloseAction = () => {
    if (!trade.closeLeg) {
      return { action: "Open", price: "", date: "" };
    }

    const price = trade.closeLeg.price !== null && trade.closeLeg.price > 0
      ? `@ $${trade.closeLeg.price.toFixed(2)}`
      : "";

    return {
      action: trade.closeLeg.action,
      price,
      date: trade.closeLeg.date,
    };
  };

  const openAction = getOpenAction();
  const closeAction = getCloseAction();
  const isOpen = trade.status === "open";

  // If no openLeg, this is a close-only trade (e.g., rolled from previous cycle)
  if (!openAction) {
    return (
      <div className="rounded-lg border bg-card">
        <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-4 px-5 py-3">
          <div className="text-muted-foreground italic">Rolled from previous</div>
          <div className="text-muted-foreground text-lg">→</div>
          <div>
            <div className="font-medium">{closeAction.action} {closeAction.price}</div>
            <div className="text-xs text-muted-foreground">{closeAction.date}</div>
          </div>
          <div className="text-right min-w-[100px]">
            {trade.netPnL !== null && (
              <>
                <div className={`font-mono font-semibold ${trade.netPnL >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {trade.netPnL >= 0 ? "+" : ""}{formatCurrency(trade.netPnL)}
                </div>
                <div className="text-xs text-muted-foreground">P&L</div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-4 px-5 py-3">
        {/* Opening action */}
        <div>
          <div className="font-medium">{openAction.action} {openAction.price}</div>
          <div className="text-xs text-muted-foreground">{openAction.date}</div>
        </div>

        {/* Arrow */}
        <div className="text-muted-foreground text-lg">→</div>

        {/* Closing action */}
        <div>
          {isOpen ? (
            <span className="text-blue-600 font-medium">Position open</span>
          ) : (
            <>
              <div className="font-medium">{closeAction.action} {closeAction.price}</div>
              <div className="text-xs text-muted-foreground">{closeAction.date}</div>
            </>
          )}
        </div>

        {/* Result */}
        <div className="text-right min-w-[100px]">
          {trade.netPnL !== null ? (
            <>
              <div className={`font-mono font-semibold ${trade.netPnL >= 0 ? "text-green-600" : "text-red-600"}`}>
                {trade.netPnL >= 0 ? "+" : ""}{formatCurrency(trade.netPnL)}
              </div>
              <div className="text-xs text-muted-foreground">P&L</div>
            </>
          ) : (
            <>
              <div className={`font-mono font-medium ${openAction && trade.openLeg && trade.openLeg.total >= 0 ? "text-green-600" : "text-red-600"}`}>
                {trade.openLeg && trade.openLeg.total >= 0 ? "+" : ""}{trade.openLeg ? formatCurrency(trade.openLeg.total) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                {trade.type === "STOCK" ? "Cost" : "Premium"}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CycleTradesView({ cycle }: { cycle: import("@assup/shared").WheelCycle }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium">Trades in Cycle {cycle.cycleNumber}</h4>
        <span className="text-sm text-muted-foreground">
          {cycle.trades.length} trade{cycle.trades.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-2">
        {cycle.trades.map((trade) => (
          <MatchedTradeRow key={trade.id} trade={trade} />
        ))}
        {cycle.trades.length === 0 && (
          <div className="text-center text-muted-foreground py-4">
            No trades in this cycle
          </div>
        )}
      </div>
    </div>
  );
}
