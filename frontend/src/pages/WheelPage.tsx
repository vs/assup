import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";
import type {
  WheelListResponse,
  WheelTickerSummary,
  WheelSuggestion,
  WheelMatchedTrade,
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
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
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

export function WheelPage() {
  const [data, setData] = useState<WheelListResponse | null>(null);
  const [suggestions, setSuggestions] = useState<WheelSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [wheelData, suggestionsData] = await Promise.all([
        api.wheel.list(),
        api.wheel.suggestions(),
      ]);
      setData(wheelData);
      setSuggestions(suggestionsData.suggestions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
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
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add ticker");
    }
  };

  const handleRemoveTicker = async (symbol: string) => {
    if (!confirm(`Remove ${symbol} from wheel tracking?`)) return;
    try {
      await api.wheel.remove(symbol);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove ticker");
    }
  };

  const handleAddSuggestion = async (symbol: string) => {
    try {
      await api.wheel.add(symbol);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add ticker");
    }
  };

  const handleDismissSuggestion = async (symbol: string) => {
    try {
      await api.wheel.dismissSuggestion(symbol);
      setSuggestions((prev) => prev.filter((s) => s.symbol !== symbol));
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
                              <Trash2 className="h-4 w-4" />
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricCard
            label="Capital Deployed"
            value={formatCurrency(data.metrics.capitalDeployed)}
          />
          <MetricCard
            label="Total P&L"
            value={(data.metrics.totalPremiums >= 0 ? "+" : "") + formatCurrency(data.metrics.totalPremiums)}
            className={data.metrics.totalPremiums >= 0 ? "text-green-600" : "text-red-600"}
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
      <div className="space-y-4">
        {data?.tickers.map((ticker) => (
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
          />
        ))}
        {data?.tickers.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No tickers tracked yet. Add a ticker or select from suggestions.
            </CardContent>
          </Card>
        )}
      </div>
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
}: {
  ticker: WheelTickerSummary;
  isExpanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const phaseLabels: Record<WheelTickerSummary["currentPhase"], string> = {
    csp_open: "CSP Open",
    holding_shares: "Holding Shares",
    cc_open: "CC Open",
    idle: "Idle",
  };

  const phaseColors: Record<WheelTickerSummary["currentPhase"], string> = {
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <CardTitle className="text-lg">{ticker.symbol}</CardTitle>
            <Badge className={phaseColors[ticker.currentPhase]}>
              {phaseLabels[ticker.currentPhase]}
            </Badge>
            {ticker.currentPrice && (
              <span className="text-sm text-muted-foreground">
                ${ticker.currentPrice.toFixed(2)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Cost Basis</div>
              <div className="font-semibold">
                ${ticker.adjustedCostBasis.toFixed(2)}
                {ticker.percentBelowMarket !== null && (
                  <span className="text-xs text-green-600 ml-1">
                    ({ticker.percentBelowMarket.toFixed(1)}% below)
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">P&L</div>
              <div className={`font-semibold ${ticker.totalPremiums >= 0 ? "text-green-600" : "text-red-600"}`}>
                {ticker.totalPremiums >= 0 ? "+" : ""}{formatCurrency(ticker.totalPremiums)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Cycles</div>
              <div className="font-semibold">
                {ticker.cycleCount} ({ticker.completedCycles} done)
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <Trash2 className="h-4 w-4" />
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
  const [detail, setDetail] = useState<import("@assup/shared").WheelTickerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCycleNumber, setSelectedCycleNumber] = useState<number | null>(null);

  useEffect(() => {
    api.wheel
      .detail(symbol)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return <div className="py-4 text-center text-muted-foreground">Loading...</div>;
  }

  if (!detail) {
    return <div className="py-4 text-center text-muted-foreground">No data</div>;
  }

  // Filter cycles: always show in-progress, plus completed cycles from last 2 years
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const twoYearsAgoStr = twoYearsAgo.toISOString().split("T")[0];
  const recentCycles = detail.cycles.filter(
    (cycle) => cycle.status === "in_progress" || cycle.startDate >= twoYearsAgoStr
  );
  const hasOlderCycles = detail.cycles.length > recentCycles.length;

  // Default to the last cycle if none selected
  const selectedCycle = recentCycles.find((c) => c.cycleNumber === selectedCycleNumber)
    || recentCycles[recentCycles.length - 1];

  return (
    <div className="space-y-4">
      {/* Cycle Summary Cards */}
      <div className="flex gap-4 overflow-x-auto p-2">
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
      {recentCycles.length === 0 && hasOlderCycles && (
        <div className="text-center text-muted-foreground py-4">
          {detail.cycles.length} older cycle{detail.cycles.length !== 1 ? "s" : ""} not shown (started before {twoYearsAgoStr}).
        </div>
      )}
      {hasOlderCycles && recentCycles.length > 0 && (
        <div className="text-center text-xs text-muted-foreground py-2">
          + {detail.cycles.length - recentCycles.length} older cycle{detail.cycles.length - recentCycles.length !== 1 ? "s" : ""} not shown
        </div>
      )}
    </div>
  );
}

// Compute cycle-level cash flow and P&L from matched trades
function CycleSummaryMetrics({ cycle }: { cycle: import("@assup/shared").WheelCycle }) {
  // Calculate totals from matched trades
  let totalCashFlow = 0;
  let totalPnL = 0;

  for (const trade of cycle.trades) {
    // Cash flow: sum of open and close leg totals
    if (trade.openLeg) {
      totalCashFlow += trade.openLeg.total;
    }
    if (trade.closeLeg) {
      totalCashFlow += trade.closeLeg.total;
    }
    // P&L: only count if the trade is closed
    if (trade.netPnL !== null) {
      totalPnL += trade.netPnL;
    }
  }

  return (
    <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
      <div>
        <div className="text-muted-foreground">Cash Flow</div>
        <div className={`font-medium ${totalCashFlow >= 0 ? "text-green-600" : "text-red-600"}`}>
          {totalCashFlow >= 0 ? "+" : ""}{formatCurrency(totalCashFlow)}
        </div>
      </div>
      <div>
        <div className="text-muted-foreground">P&L</div>
        <div className={`font-medium ${totalPnL >= 0 ? "text-green-600" : "text-red-600"}`}>
          {totalPnL >= 0 ? "+" : ""}{formatCurrency(totalPnL)}
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
  const [expanded, setExpanded] = useState(false);

  const statusColors: Record<WheelMatchedTrade["status"], string> = {
    open: "bg-blue-100 text-blue-800",
    closed: "bg-gray-100 text-gray-800",
    expired: "bg-green-100 text-green-800",
    assigned: "bg-yellow-100 text-yellow-800",
    called_away: "bg-purple-100 text-purple-800",
  };

  const statusLabels: Record<WheelMatchedTrade["status"], string> = {
    open: "Open",
    closed: "Closed",
    expired: "Expired",
    assigned: "Assigned",
    called_away: "Called",
  };

  return (
    <div className="rounded bg-muted">
      {/* Summary row (always visible) */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/80"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="font-medium">{trade.displayName}</span>
          <Badge className={statusColors[trade.status]}>
            {statusLabels[trade.status]}
          </Badge>
        </div>
        <div className="flex items-center gap-4">
          {trade.netPnL !== null ? (
            <span
              className={`font-mono font-medium ${
                trade.netPnL >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {trade.netPnL >= 0 ? "+" : ""}
              {formatCurrency(trade.netPnL)}
            </span>
          ) : (
            <span className="font-mono text-muted-foreground">—</span>
          )}
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
      </div>

      {/* Expanded legs (collapsible) */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 space-y-1 text-sm border-t border-border/50">
          {trade.openLeg && (
            <div className="flex justify-between text-muted-foreground pt-2">
              <span>
                {trade.openLeg.date}: {trade.openLeg.action}
                {trade.openLeg.price > 0 && (
                  <span className="ml-1">@ ${trade.openLeg.price.toFixed(2)}</span>
                )}
              </span>
              <span
                className={
                  trade.openLeg.total >= 0 ? "text-green-600" : "text-red-600"
                }
              >
                {trade.openLeg.total >= 0 ? "+" : ""}
                {formatCurrency(trade.openLeg.total)}
              </span>
            </div>
          )}
          {trade.closeLeg && (
            <div className="flex justify-between text-muted-foreground">
              <span>
                {trade.closeLeg.date}: {trade.closeLeg.action}
                {trade.closeLeg.price !== null && trade.closeLeg.price > 0 && (
                  <span className="ml-1">@ ${trade.closeLeg.price.toFixed(2)}</span>
                )}
              </span>
              <span
                className={
                  trade.closeLeg.total >= 0 ? "text-green-600" : "text-red-600"
                }
              >
                {trade.closeLeg.total >= 0 ? "+" : ""}
                {formatCurrency(trade.closeLeg.total)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CycleTradesView({ cycle }: { cycle: import("@assup/shared").WheelCycle }) {
  return (
    <div>
      <h4 className="font-medium mb-2">Trades (Cycle {cycle.cycleNumber})</h4>
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
