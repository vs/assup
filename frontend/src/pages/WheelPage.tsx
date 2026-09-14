import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { api } from "@/api";
import type {
  WheelListResponse,
  WheelTickerSummary,
  WheelSuggestion,
  WheelMatchedTrade,
  WheelDividend,
  WheelLivePosition,
  SparklinePoint,
  CurrentOptionPosition,
  Order,
} from "@assup/shared";
import { formatCurrency, formatDisplayName } from "@assup/shared";
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
import { useSparklines, useWheelUpdates } from "@/hooks";
import { Plus, X, ChevronDown, ChevronUp, Loader2, Check, Vault, TrendingUp, TrendingUpDown, PercentCircle, CircleDot, RefreshCw, ShoppingCart } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { scannerApi } from "@/api/scanner";
import type { ScannerCriteria } from "@assup/shared";
import { OptionsBuilderDialog } from "@/components/options-builder/OptionsBuilderDialog";
import { ClosePositionDialog } from "@/components/profit/ClosePositionDialog";
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

/**
 * Map a wheel option leg to the position shape ClosePositionDialog expects.
 * Wheel single legs are always short, so quantity is negated (→ buy to close)
 * and per-share avgCost becomes per-contract.
 */
function wheelLegToClosePosition(
  symbol: string,
  pos: WheelLivePosition
): CurrentOptionPosition | null {
  if ((pos.type !== "put" && pos.type !== "call") || pos.strike == null || !pos.expiry) {
    return null;
  }
  const right = pos.type === "call" ? "C" : "P";
  return {
    symbol,
    displayName: formatDisplayName({
      symbol,
      secType: "OPT",
      strike: pos.strike,
      right,
      lastTradeDateOrContractMonth: pos.expiry.replace(/-/g, ""),
    }),
    underlying: symbol,
    strike: pos.strike,
    expiry: pos.expiry,
    right,
    quantity: -pos.quantity,
    avgCost: pos.avgCost * 100,
    marketPrice: pos.marketPrice ?? 0,
    marketValue: -(pos.marketPrice ?? 0) * pos.quantity * 100,
    unrealizedPnl: pos.pnl ?? 0,
    projectedProfit: 0,
  };
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
  // True while the backend's background live-data refresh is in flight (between
  // the instant cached response and the "wheel_strategy" SSE event).
  const [refreshing, setRefreshing] = useState(false);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  // Global keyboard capture: typing letters focuses the filter input automatically
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape → clear filter (works even when focused in the filter input)
      if (e.key === "Escape" && filter) {
        setFilter("");
        filterRef.current?.blur();
        return;
      }

      // Skip if user is already in an input/textarea/dialog
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Single letter/digit → focus filter and let the keystroke through
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        filterRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filter]);

  const filteredTickers = useMemo(() => {
    if (!data?.tickers) return [];
    if (!filter) return data.tickers;
    const q = filter.toUpperCase();
    return data.tickers.filter((t) => t.symbol.includes(q));
  }, [data?.tickers, filter]);

  // Active wheels first, idle ones dimmed below a divider
  const { activeTickers, idleTickers } = useMemo(
    () => ({
      activeTickers: filteredTickers.filter((t) => t.currentPhase !== "idle"),
      idleTickers: filteredTickers.filter((t) => t.currentPhase === "idle"),
    }),
    [filteredTickers]
  );

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
      // The instant response triggers a background live refresh on the server;
      // show a spinner until the "wheel_strategy" SSE event lands (or times out).
      setRefreshing(true);
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

  // Live data arrives over SSE once the backend's background fan-out finishes.
  // Replace tickers + metrics (keep the separately-loaded suggestions) and cache.
  useWheelUpdates((payload) => {
    const update = payload as Partial<Pick<WheelListResponse, "tickers" | "metrics">>;
    if (!update?.tickers || !update?.metrics) return;
    setData((prev) => {
      const next: WheelListResponse = {
        tickers: update.tickers!,
        metrics: update.metrics!,
        suggestions: prev?.suggestions ?? [],
      };
      writeCache(CACHE_KEYS.tickers, next);
      return next;
    });
    setRefreshing(false);
  });

  // Safety net: clear the refreshing spinner if no SSE update lands (e.g. SSE
  // disconnected or the server-side refresh failed) so it can't spin forever.
  useEffect(() => {
    if (!refreshing) return;
    const timer = setTimeout(() => setRefreshing(false), 50_000);
    return () => clearTimeout(timer);
  }, [refreshing]);

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

  const renderTickerCard = (ticker: WheelTickerSummary) => {
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
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wheel"
        subtitle="Track your wheel strategy performance"
        loading={loading || refreshing}
        onRefresh={loadData}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <input
                ref={filterRef}
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter..."
                className="h-8 w-32 rounded-md border bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              />
              {filter && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setFilter("")} className="h-8 px-1.5">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {filteredTickers.length}/{data?.tickers.length ?? 0}
                  </span>
                </>
              )}
            </div>
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
            icon={Vault}
            value={formatCurrency(data.metrics.capitalDeployed)}
          />
          <MetricCard
            label="Realized P&L"
            icon={TrendingUp}
            value={(data.metrics.totalRealizedPnL >= 0 ? "+" : "") + formatCurrency(data.metrics.totalRealizedPnL)}
            className={data.metrics.totalRealizedPnL >= 0 ? "text-green-600" : "text-red-600"}
          />
          <MetricCard
            label="Unrealized P&L"
            icon={TrendingUpDown}
            value={(data.metrics.totalUnrealizedPnL >= 0 ? "+" : "") + formatCurrency(data.metrics.totalUnrealizedPnL)}
            className={data.metrics.totalUnrealizedPnL >= 0 ? "text-green-600" : "text-red-600"}
          />
          <MetricCard
            label="Yield"
            icon={PercentCircle}
            value={`${data.metrics.premiumYieldAnnualized.toFixed(1)}%`}
          />
          <MetricCard
            label="Active Wheels"
            icon={CircleDot}
            value={data.metrics.activeWheels.toString()}
          />
          <MetricCard
            label="Completed Cycles"
            icon={RefreshCw}
            value={data.metrics.completedCycles.toString()}
          />
        </div>
      )}

      {/* Ticker Cards */}
      <div className="space-y-4 mt-4">
        {activeTickers.map(renderTickerCard)}
        {activeTickers.length > 0 && idleTickers.length > 0 && (
          <div className="border-t border-border" />
        )}
        {idleTickers.map((ticker) => (
          <div
            key={ticker.symbol}
            className="opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100"
          >
            {renderTickerCard(ticker)}
          </div>
        ))}
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
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between mb-2">
          <div className="text-xs text-muted-foreground font-medium">{label}</div>
          <Icon className="h-4 w-4 text-muted-foreground/60" />
        </div>
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
  const [scanState, setScanState] = useState<Record<string, "loading" | "done">>({});
  const [builderOpen, setBuilderOpen] = useState(false);

  const startScanJob = async (symbol: string, optionType: "PUT" | "CALL") => {
    const key = `${symbol}:${optionType}`;
    if (scanState[key] === "loading") return;

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
    setScanState(prev => ({ ...prev, [key]: "loading" }));
    try {
      await scannerApi.jobs.create({
        criteria: { ...baseCriteria, specificSymbol: symbol },
      });
      setScanState(prev => ({ ...prev, [key]: "done" }));
      setTimeout(() => setScanState(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      }), 1500);
    } catch (err) {
      console.error("Failed to start scan job:", err);
      setScanState(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const phaseLabels: Record<string, string> = {
    csp_open: "CSP",
    holding_shares: "Shares",
    cc_open: "CC",
    idle: "Idle",
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
          <div className="w-[70px] shrink-0">
            <CardTitle className="text-lg">
              <TickerHoverCard symbol={ticker.symbol}>
                <span className="cursor-default">{ticker.symbol}</span>
              </TickerHoverCard>
            </CardTitle>
          </div>
          <div className="w-[68px] shrink-0" onClick={(e) => e.stopPropagation()}>
            <Sparkline
              data={sparklineData}
              loading={sparklineLoading}
              error={sparklineError}
              onChartClick={onChartClick}
              width={60}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 shrink-0 ml-2 w-[420px]">
            {/* Shares column */}
            <div className="text-right">
              {ticker.activePhases?.includes("holding_shares") && ticker.shareQuantity > 0 ? (
                <>
                  <div className="text-xs text-muted-foreground">{ticker.shareQuantity} @ ${(ticker.positionAvgCost ?? ticker.adjustedCostBasis).toFixed(2)}</div>
                  <div className={`font-semibold ${ticker.sharePnL != null ? (ticker.sharePnL >= 0 ? "text-green-600" : "text-red-600") : ""}`}>
                    {ticker.sharePnL != null ? (
                      <>
                        {ticker.sharePnL >= 0 ? "+" : ""}{formatCurrency(ticker.sharePnL)}
                        {ticker.sharePnLPercent != null && (
                          <span className="text-xs ml-1">({ticker.sharePnLPercent >= 0 ? "+" : ""}{ticker.sharePnLPercent.toFixed(0)}%)</span>
                        )}
                      </>
                    ) : "—"}
                  </div>
                </>
              ) : (
                ticker.currentPhase === "idle" ? (
                  <>
                    <div className="text-xs text-muted-foreground">{phaseLabels[ticker.currentPhase]}</div>
                    <div className="font-semibold text-muted-foreground">—</div>
                  </>
                ) : null
              )}
            </div>
            {/* CC column */}
            <div className="text-right border-l border-border pl-4">
              {ticker.activePhases?.includes("cc_open") && (
                <>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    CC{ticker.activeOptions?.nearestCall && (
                      <> {formatShortExpiry(ticker.activeOptions.nearestCall.expiry)} ${ticker.activeOptions.nearestCall.strike}</>
                    )}
                    {(ticker.activeOptions?.totalCallContracts ?? 0) > 1 && (
                      <> x{ticker.activeOptions!.totalCallContracts}</>
                    )}
                  </div>
                  <div className={`font-semibold ${ticker.activeOptions?.callsPnL != null ? (ticker.activeOptions.callsPnL >= 0 ? "text-green-600" : "text-red-600") : ""}`}>
                    {ticker.activeOptions?.callsPnL != null ? (
                      <>
                        {ticker.activeOptions.callsPnL >= 0 ? "+" : ""}{formatCurrency(ticker.activeOptions.callsPnL)}
                        {ticker.activeOptions.callsPnLPercent != null && (
                          <span className="text-xs ml-1">({ticker.activeOptions.callsPnLPercent >= 0 ? "+" : ""}{ticker.activeOptions.callsPnLPercent.toFixed(0)}%)</span>
                        )}
                      </>
                    ) : "—"}
                  </div>
                </>
              )}
            </div>
            {/* CSP column */}
            <div className="text-right border-l border-border pl-4">
              {ticker.activePhases?.includes("csp_open") && (
                <>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    CSP{ticker.activeOptions?.nearestPut && (
                      <> {formatShortExpiry(ticker.activeOptions.nearestPut.expiry)} ${ticker.activeOptions.nearestPut.strike}</>
                    )}
                    {(ticker.activeOptions?.totalPutContracts ?? 0) > 1 && (
                      <> x{ticker.activeOptions!.totalPutContracts}</>
                    )}
                  </div>
                  <div className={`font-semibold ${ticker.activeOptions?.putsPnL != null ? (ticker.activeOptions.putsPnL >= 0 ? "text-green-600" : "text-red-600") : ""}`}>
                    {ticker.activeOptions?.putsPnL != null ? (
                      <>
                        {ticker.activeOptions.putsPnL >= 0 ? "+" : ""}{formatCurrency(ticker.activeOptions.putsPnL)}
                        {ticker.activeOptions.putsPnLPercent != null && (
                          <span className="text-xs ml-1">({ticker.activeOptions.putsPnLPercent >= 0 ? "+" : ""}{ticker.activeOptions.putsPnLPercent.toFixed(0)}%)</span>
                        )}
                      </>
                    ) : "—"}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="grid shrink-0 ml-auto w-[580px] gap-x-3" style={{ gridTemplateColumns: "80px 80px 1fr 1fr 50px" }}>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Price</div>
              <div className="font-semibold">{ticker.currentPrice ? `$${ticker.currentPrice.toFixed(2)}` : "—"}</div>
            </div>
            <div className="text-right border-l border-border pl-4">
              <div className="text-xs text-muted-foreground">Cost Basis</div>
              <div className="font-semibold">${ticker.adjustedCostBasis.toFixed(2)}</div>
              {ticker.totalDividends > 0 && (
                <div
                  className="text-[10px] text-green-600 tabular-nums"
                  title="Dividends received while holding wheel shares, net of withholding tax"
                >
                  div +{formatCurrency(ticker.totalDividends)}
                </div>
              )}
            </div>
            <div className="text-right border-l border-border pl-4">
              <div className="text-xs text-muted-foreground">Realized</div>
              <div className={`font-semibold ${ticker.realizedPnL >= 0 ? "text-green-600" : "text-red-600"}`}>
                {ticker.realizedPnL >= 0 ? "+" : ""}{formatCurrency(ticker.realizedPnL)}
                {ticker.realizedPnLPercent !== null && (
                  <span className="text-xs ml-1">({ticker.realizedPnLPercent.toFixed(1)}%)</span>
                )}
              </div>
            </div>
            <div className="text-right border-l border-border pl-4">
              <div className="text-xs text-muted-foreground">Unrealized</div>
              <div className={`font-semibold ${ticker.unrealizedPnL >= 0 ? "text-green-600" : "text-red-600"}`}>
                {ticker.unrealizedPnL >= 0 ? "+" : ""}{formatCurrency(ticker.unrealizedPnL)}
                {ticker.unrealizedPnLPercent !== null && (
                  <span className="text-xs ml-1">({ticker.unrealizedPnLPercent.toFixed(1)}%)</span>
                )}
              </div>
            </div>
            <div className="text-right border-l border-border pl-4">
              <div className="text-xs text-muted-foreground">Cycles</div>
              <div className="font-semibold">
                {ticker.cycleCount}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-6">
            <Button
              variant="ghost"
              size="sm"
              title="Open options builder"
              className="text-xs"
              onClick={(e) => {
                e.stopPropagation();
                setBuilderOpen(true);
              }}
            >
              <ShoppingCart className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Scan puts"
              className="text-xs w-8 px-0"
              disabled={scanState[`${ticker.symbol}:PUT`] === "loading"}
              onClick={(e) => {
                e.stopPropagation();
                startScanJob(ticker.symbol, "PUT");
              }}
            >
              {scanState[`${ticker.symbol}:PUT`] === "loading" ? <Loader2 className="h-3 w-3 animate-spin" />
                : scanState[`${ticker.symbol}:PUT`] === "done" ? <Check className="h-3 w-3 text-green-500" />
                : "P"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Scan calls"
              className="text-xs w-8 px-0"
              disabled={scanState[`${ticker.symbol}:CALL`] === "loading"}
              onClick={(e) => {
                e.stopPropagation();
                startScanJob(ticker.symbol, "CALL");
              }}
            >
              {scanState[`${ticker.symbol}:CALL`] === "loading" ? <Loader2 className="h-3 w-3 animate-spin" />
                : scanState[`${ticker.symbol}:CALL`] === "done" ? <Check className="h-3 w-3 text-green-500" />
                : "C"}
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
      <OptionsBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        symbol={ticker.symbol}
        onOrderPlaced={() => {
          setBuilderOpen(false);
        }}
      />
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
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [closePosition, setClosePosition] = useState<CurrentOptionPosition | null>(null);
  const [existingOrderForDialog, setExistingOrderForDialog] = useState<Order | null>(null);

  const loadDetail = useCallback(() => {
    api.wheel
      .detail(symbol)
      .then((data) => {
        setDetail(data);
        writeCache(cacheKey, data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [symbol, cacheKey]);

  const loadOrders = useCallback(() => {
    api.orders.list()
      .then(setOpenOrders)
      .catch(() => setOpenOrders([]));
  }, []);

  useEffect(() => {
    loadDetail();
    loadOrders();
  }, [loadDetail, loadOrders]);

  if (loading) {
    return <div className="py-4 text-center text-muted-foreground">Loading...</div>;
  }

  if (!detail) {
    return <div className="py-4 text-center text-muted-foreground">No data</div>;
  }

  const INITIAL_CYCLE_LIMIT = 3;

  // Newest cycles first; show the last N by default (always including in-progress)
  const allCycles = [...detail.cycles].reverse();
  const visibleCycles = showAllCycles
    ? allCycles
    : allCycles.slice(0, INITIAL_CYCLE_LIMIT);
  const hasOlderCycles = allCycles.length > INITIAL_CYCLE_LIMIT;

  // Default to the most recent cycle if none selected
  const selectedCycle = allCycles.find((c) => c.cycleNumber === selectedCycleNumber)
    || allCycles[0];

  const hasPositions = detail.livePositions?.length > 0;

  const cycleList = allCycles.length > 0 ? (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex h-9 items-center justify-between border-b bg-muted/30 px-3">
        <h4 className="text-xs font-medium text-muted-foreground">
          Cycles <span className="tabular-nums">({allCycles.length})</span>
        </h4>
        {hasOlderCycles && (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setShowAllCycles((v) => !v)}
          >
            {showAllCycles ? "Show less" : "Show all"}
          </button>
        )}
      </div>
      <div className={`divide-y divide-border/50 ${showAllCycles ? "max-h-64 overflow-y-auto" : ""}`}>
        {visibleCycles.map((cycle) => (
          <CycleRow
            key={cycle.cycleNumber}
            cycle={cycle}
            selected={selectedCycle?.cycleNumber === cycle.cycleNumber}
            onSelect={() => setSelectedCycleNumber(cycle.cycleNumber)}
          />
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      {/* Positions (left) + cycle list (right) */}
      {hasPositions ? (
        <div className="grid grid-cols-[1.4fr_1fr] gap-6 items-start">
          <ActivePositions
            positions={detail.livePositions}
            symbol={symbol}
            openOrders={openOrders}
            onClosePosition={(pos, order) => {
              setClosePosition(pos);
              setExistingOrderForDialog(order);
            }}
          />
          {cycleList}
        </div>
      ) : (
        cycleList
      )}

      {/* Trade log for the selected cycle */}
      {selectedCycle ? (
        <CycleTradesView cycle={selectedCycle} />
      ) : (
        <div className="text-center text-muted-foreground py-4">
          No wheel cycles found. Sell a PUT or buy shares to start tracking.
        </div>
      )}

      <ClosePositionDialog
        open={!!closePosition}
        onOpenChange={(open) => {
          if (!open) {
            setClosePosition(null);
            setExistingOrderForDialog(null);
          }
        }}
        position={closePosition}
        existingOrder={existingOrderForDialog}
        onOrderPlaced={() => {
          loadOrders();
          loadDetail();
        }}
      />
    </div>
  );
}

const CYCLE_STATUS_LABELS: Record<string, string> = {
  in_progress: "In Progress",
  called_away: "Called Away",
  expired_worthless: "Expired",
  closed: "Closed",
  sold_shares: "Sold",
};

/** One compact, selectable row in the cycle list. */
function CycleRow({
  cycle,
  selected,
  onSelect,
}: {
  cycle: import("@assup/shared").WheelCycle;
  selected: boolean;
  onSelect: () => void;
}) {
  const inProgress = cycle.status === "in_progress";
  // In-progress P&L is realized + unrealized; completed cycles carry P&L in realizedPnL.
  const pnl = inProgress
    ? cycle.realizedPnL + (cycle.unrealizedPnL ?? 0)
    : cycle.realizedPnL;
  const endLabel = inProgress ? "now" : (cycle.endDate ? formatShortExpiry(cycle.endDate) : "—");

  return (
    <button
      type="button"
      onClick={onSelect}
      title={cycle.exitDescription ?? cycle.entryDescription}
      className={`group flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
        selected
          ? "bg-primary/10 border-l-2 border-l-primary"
          : "border-l-2 border-l-transparent hover:bg-muted/50"
      }`}
    >
      {/* Status dot */}
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          inProgress ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"
        }`}
        title={CYCLE_STATUS_LABELS[cycle.status] ?? cycle.status}
      />
      {/* Cycle number */}
      <span className="w-7 shrink-0 font-medium tabular-nums text-muted-foreground">
        #{cycle.cycleNumber}
      </span>
      {/* Date range */}
      <span className="flex-1 truncate text-xs text-muted-foreground tabular-nums">
        {formatShortExpiry(cycle.startDate)} <span className="opacity-50">→</span> {endLabel}
      </span>
      {/* P&L */}
      <span className={`w-16 shrink-0 text-right font-medium tabular-nums ${pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
        {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)}
      </span>
      {/* ROC */}
      <span
        className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
        title={`${cycle.annualizedRoc.toFixed(0)}% annualized`}
      >
        {cycle.roc.toFixed(1)}%
      </span>
    </button>
  );
}

function ActivePositions({
  positions,
  symbol,
  openOrders,
  onClosePosition,
}: {
  positions: WheelLivePosition[];
  symbol: string;
  openOrders: Order[];
  onClosePosition: (pos: CurrentOptionPosition, existingOrder: Order | null) => void;
}) {
  const shares = positions.find((p) => p.type === "shares");
  // CC and Call Spreads together, sorted by expiry
  const callSide = positions
    .filter((p) => p.type === "call" || p.type === "call-spread")
    .sort((a, b) => (a.expiry ?? "").localeCompare(b.expiry ?? ""));
  // CSP and Put Spreads together, sorted by expiry
  const putSide = positions
    .filter((p) => p.type === "put" || p.type === "put-spread")
    .sort((a, b) => (a.expiry ?? "").localeCompare(b.expiry ?? ""));

  const pnlColor = (v: number | null) =>
    v == null ? "text-muted-foreground" : v >= 0 ? "text-green-600" : "text-red-600";

  const fmtPnL = (v: number | null) =>
    v == null ? "—" : `${v >= 0 ? "+" : ""}${formatCurrency(v)}`;

  const fmtPct = (v: number | null) =>
    v == null ? "" : ` ${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;

  // Total premium kept if every short option here expires worthless.
  const hasProjected = positions.some((p) => p.projectedProfit != null);
  const totalProjected = positions.reduce((sum, p) => sum + (p.projectedProfit ?? 0), 0);

  const projectedCell = (p: WheelLivePosition) => (
    <td className={`px-3 py-2 text-right tabular-nums ${pnlColor(p.projectedProfit)}`}>
      {p.projectedProfit != null ? fmtPnL(p.projectedProfit) : "—"}
    </td>
  );

  // Action cell: Close button, or "price x qty / Adjust" when a close order exists
  const renderActionCell = (p: WheelLivePosition) => {
    const closeTarget = wheelLegToClosePosition(symbol, p);
    if (!closeTarget) return <td className="px-2 py-2" />;
    const matchingOrder = openOrders.find(
      (o) => o.action === "BUY" && o.secType === "OPT" && o.displayName === closeTarget.displayName
    );
    return (
      <td className="px-2 py-2 text-right whitespace-nowrap">
        {matchingOrder ? (
          <span
            className="cursor-pointer group/order relative text-xs tabular-nums"
            onClick={() => onClosePosition(closeTarget, matchingOrder)}
          >
            {formatCurrency(matchingOrder.limitPrice ?? 0)} x {matchingOrder.quantity}
            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/order:opacity-100 bg-card text-xs">
              Adjust
            </span>
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onClosePosition(closeTarget, null)}
          >
            Close
          </Button>
        )}
      </td>
    );
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex h-9 items-center border-b bg-muted/30 px-3">
        <h4 className="text-xs font-medium text-muted-foreground">Positions</h4>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground/60">
            <th className="text-left font-normal px-3 py-1.5">Position</th>
            <th className="text-right font-normal px-3 py-1.5">Avg Cost</th>
            <th className="text-right font-normal px-3 py-1.5">Mkt</th>
            <th className="text-right font-normal px-3 py-1.5">Theta</th>
            <th className="text-right font-normal px-3 py-1.5">P&L</th>
            <th className="text-right font-normal px-3 py-1.5" title="Profit if the short option expires worthless">Projected</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {shares && (
            <tr className="border-b border-border/50">
              <td className="px-3 py-2 font-medium">
                {shares.quantity} shares
              </td>
              <td className="px-3 py-2 text-right tabular-nums">${shares.avgCost.toFixed(2)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {shares.marketPrice != null ? `$${shares.marketPrice.toFixed(2)}` : "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">—</td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${pnlColor(shares.pnl)}`}>
                {fmtPnL(shares.pnl)}{fmtPct(shares.pnlPercent)}
              </td>
              {projectedCell(shares)}
              <td className="px-2 py-2" />
            </tr>
          )}
          {callSide.map((c, i) => (
            <tr key={`c-${i}`} className="border-b border-border/50">
              <td className="px-3 py-2 font-medium whitespace-nowrap">
                {c.type === "call-spread" ? (
                  <>CS {c.expiry ? formatShortExpiry(c.expiry) : ""} ${c.shortStrike}/{c.longStrike}</>
                ) : (
                  <>CC {c.expiry ? formatShortExpiry(c.expiry) : ""} ${c.strike}</>
                )}
                {c.quantity > 1 && <span className="opacity-75"> x{c.quantity}</span>}
                {c.dte != null && <span className="text-xs text-muted-foreground ml-1">({c.dte}d)</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">${c.avgCost.toFixed(2)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {c.marketPrice != null ? `$${c.marketPrice.toFixed(2)}` : "—"}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${c.theta != null ? (c.theta >= 0 ? "text-green-600" : "text-red-600") : "text-muted-foreground"}`}>
                {c.theta != null ? formatCurrency(c.theta) : "—"}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${pnlColor(c.pnl)}`}>
                {fmtPnL(c.pnl)}{fmtPct(c.pnlPercent)}
              </td>
              {projectedCell(c)}
              {renderActionCell(c)}
            </tr>
          ))}
          {putSide.map((p, i) => (
            <tr key={`p-${i}`} className={i < putSide.length - 1 ? "border-b border-border/50" : ""}>
              <td className="px-3 py-2 font-medium whitespace-nowrap">
                {p.type === "put-spread" ? (
                  <>PS {p.expiry ? formatShortExpiry(p.expiry) : ""} ${p.shortStrike}/{p.longStrike}</>
                ) : (
                  <>CSP {p.expiry ? formatShortExpiry(p.expiry) : ""} ${p.strike}</>
                )}
                {p.quantity > 1 && <span className="opacity-75"> x{p.quantity}</span>}
                {p.dte != null && <span className="text-xs text-muted-foreground ml-1">({p.dte}d)</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">${p.avgCost.toFixed(2)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {p.marketPrice != null ? `$${p.marketPrice.toFixed(2)}` : "—"}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${p.theta != null ? (p.theta >= 0 ? "text-green-600" : "text-red-600") : "text-muted-foreground"}`}>
                {p.theta != null ? formatCurrency(p.theta) : "—"}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${pnlColor(p.pnl)}`}>
                {fmtPnL(p.pnl)}{fmtPct(p.pnlPercent)}
              </td>
              {projectedCell(p)}
              {renderActionCell(p)}
            </tr>
          ))}
        </tbody>
        {hasProjected && (
          <tfoot>
            <tr className="border-t">
              <td className="px-3 py-2 text-xs text-muted-foreground" colSpan={4}>
                Projected if worthless
              </td>
              <td className="px-3 py-2" />
              <td className={`px-3 py-2 text-right tabular-nums font-semibold ${pnlColor(totalProjected)}`}>
                {fmtPnL(totalProjected)}
              </td>
              <td className="px-2 py-2" />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function formatTradeDesc(trade: WheelMatchedTrade): { open: string; close: string; date: string } {
  const date = trade.openLeg?.date ?? trade.closeLeg?.date ?? "";

  if (!trade.openLeg) {
    const cp = trade.closeLeg;
    const price = cp?.price != null && cp.price > 0 ? ` @ $${cp.price.toFixed(2)}` : "";
    return { open: "Rolled from previous", close: `${cp?.action ?? ""}${price}`, date };
  }

  let open: string;
  if (trade.type === "STOCK") {
    open = `Buy ${trade.openLeg.quantity} shares @ $${trade.openLeg.price.toFixed(2)}`;
  } else {
    const parts = trade.displayName.split(" ");
    if (parts.length >= 4) {
      open = `${trade.openLeg.action} $${parts[2]} ${parts[1]} @ $${trade.openLeg.price.toFixed(2)}`;
    } else {
      const price = trade.openLeg.price > 0 ? ` @ $${trade.openLeg.price.toFixed(2)}` : "";
      open = `${trade.openLeg.action}${price}`;
    }
  }

  let close: string;
  if (trade.status === "open") {
    close = "open";
  } else if (trade.closeLeg) {
    const price = trade.closeLeg.price != null && trade.closeLeg.price > 0
      ? ` @ $${trade.closeLeg.price.toFixed(2)}`
      : "";
    close = `${trade.closeLeg.action}${price}`;
  } else {
    close = "";
  }

  return { open, close, date };
}

function CycleTradesView({ cycle }: { cycle: import("@assup/shared").WheelCycle }) {
  if (cycle.trades.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-4 text-sm">
        No trades in this cycle
      </div>
    );
  }

  type CycleRowItem =
    | { kind: "trade"; sortDate: string; trade: WheelMatchedTrade }
    | { kind: "dividend"; sortDate: string; dividend: WheelDividend };

  // Dividends sit alongside the trades that earned them, ordered by pay date.
  const rowItems: CycleRowItem[] = [
    ...cycle.trades.map((trade) => ({
      kind: "trade" as const,
      sortDate: trade.openLeg?.date ?? trade.closeLeg?.date ?? "",
      trade,
    })),
    ...(cycle.dividends ?? []).map((dividend) => ({
      kind: "dividend" as const,
      sortDate: dividend.payDate,
      dividend,
    })),
  ].sort((a, b) => a.sortDate.localeCompare(b.sortDate));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-muted-foreground">
          Trades in Cycle {cycle.cycleNumber}
        </h4>
        <div className="flex items-center gap-3">
          {cycle.dividendIncome > 0 && (
            <span
              className="text-xs text-green-600 tabular-nums"
              title="Dividends earned in this cycle, net of withholding tax"
            >
              Dividends +{formatCurrency(cycle.dividendIncome)}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {cycle.trades.length} trade{cycle.trades.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
      {/* Spread groups */}
      {cycle.spreadGroups && cycle.spreadGroups.length > 0 && (
        <div className="mb-3 space-y-2">
          {cycle.spreadGroups.map((sg, idx) => {
            const label = sg.type.replace("-", " ").replace(/\b\w/g, c => c.toUpperCase());
            return (
              <div key={idx} className="flex items-center gap-3 text-xs border rounded px-3 py-2 bg-muted/30">
                <span className="font-medium text-muted-foreground">{label}</span>
                <span className="text-red-600">{sg.shortLeg.displayName}</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-green-600">{sg.longLeg.displayName}</span>
                <span className="text-muted-foreground ml-auto">
                  {sg.dte > 0 ? `${sg.dte} DTE` : "Expired"}
                </span>
                <span className="font-medium tabular-nums">
                  Net: {sg.netPremium >= 0 ? "+" : ""}{formatCurrency(sg.netPremium)}
                </span>
                {sg.currentPnl != null && (
                  <span className={`font-medium tabular-nums ${sg.currentPnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                    P&L: {sg.currentPnl >= 0 ? "+" : ""}{formatCurrency(sg.currentPnl)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <table className="text-xs w-full">
        <tbody>
          {rowItems.map((item) => {
            if (item.kind === "dividend") {
              const d = item.dividend;
              return (
                <tr key={`div-${d.id}`} className="border-b border-border/30 last:border-0">
                  <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap">{d.payDate}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">
                    Dividend ${d.perShare.toFixed(4)} × {d.shares} sh
                  </td>
                  <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">
                    gross {formatCurrency(d.gross)} · wht {formatCurrency(d.withholdingTax)}
                  </td>
                  <td className="py-1 text-right tabular-nums whitespace-nowrap font-medium">
                    <span className="text-green-600">+{formatCurrency(d.net)}</span>
                  </td>
                </tr>
              );
            }

            const trade = item.trade;
            const desc = formatTradeDesc(trade);
            const pnl = trade.netPnL;
            const premium = trade.openLeg?.total;
            return (
              <tr key={trade.id} className="border-b border-border/30 last:border-0">
                <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap">{desc.date}</td>
                <td className="py-1 pr-2 whitespace-nowrap">{desc.open}</td>
                <td className="py-1 pr-2 whitespace-nowrap">
                  {desc.close && (
                    trade.status === "open"
                      ? <span className="text-blue-600">open</span>
                      : <span className="text-muted-foreground">→ {desc.close}</span>
                  )}
                </td>
                <td className="py-1 text-right tabular-nums whitespace-nowrap font-medium">
                  {pnl !== null ? (
                    <span className={pnl >= 0 ? "text-green-600" : "text-red-600"}>
                      {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)}
                    </span>
                  ) : premium != null ? (
                    <span className={premium >= 0 ? "text-green-600" : "text-red-600"}>
                      {premium >= 0 ? "+" : ""}{formatCurrency(premium)}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
