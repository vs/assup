import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";
import type {
  WheelListResponse,
  WheelTickerSummary,
  WheelSuggestion,
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
                <DropdownMenuContent align="end" className="w-80">
                  {suggestions.slice(0, 5).map((s) => (
                    <DropdownMenuItem
                      key={s.symbol}
                      className="flex justify-between items-center"
                    >
                      <div>
                        <span className="font-medium">{s.symbol}</span>
                        <span className="text-xs text-muted-foreground ml-2">
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
                  ))}
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
            label="Total Premiums"
            value={formatCurrency(data.metrics.totalPremiums)}
            className="text-green-600"
          />
          <MetricCard
            label="Premium Yield"
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
    <Card className={`${isProfitable ? "border-l-4 border-l-green-500" : ""}`}>
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
              <div className="text-sm text-muted-foreground">Premiums</div>
              <div className="font-semibold text-green-600">
                {formatCurrency(ticker.totalPremiums)}
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

  return (
    <div className="space-y-4">
      {/* Cycle Summary Cards */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {detail.cycles.map((cycle) => (
          <Card
            key={cycle.cycleNumber}
            className={`min-w-[200px] ${
              cycle.status === "in_progress" ? "border-primary" : ""
            }`}
          >
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Cycle {cycle.cycleNumber}</span>
                <Badge variant={cycle.status === "in_progress" ? "default" : "secondary"}>
                  {cycle.status === "in_progress"
                    ? "In Progress"
                    : cycle.status === "called_away"
                    ? "Called Away"
                    : "Sold"}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {cycle.startDate}
                {cycle.endDate && ` → ${cycle.endDate}`}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-muted-foreground">Premium</div>
                  <div className="text-green-600 font-medium">
                    {formatCurrency(cycle.totalPremium)}
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
              <div className="text-xs text-muted-foreground mt-2">
                {cycle.durationDays} days • {cycle.trades.length} trades
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trade Timeline (for current/last cycle) */}
      {detail.cycles.length > 0 && (
        <div>
          <h4 className="font-medium mb-2">
            Recent Trades (Cycle {detail.cycles[detail.cycles.length - 1].cycleNumber})
          </h4>
          <div className="space-y-2">
            {detail.cycles[detail.cycles.length - 1].trades.map((trade) => (
              <div
                key={trade.id}
                className={`flex items-center justify-between p-2 rounded ${
                  trade.isWheelTrade ? "bg-muted" : "bg-muted/50 opacity-75"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-24">
                    {trade.tradeDate}
                  </span>
                  <Badge variant="outline">{trade.type.replace("_", " ")}</Badge>
                  {trade.strike && (
                    <span className="text-sm">
                      ${trade.strike} {trade.expiry}
                    </span>
                  )}
                  {!trade.isWheelTrade && (
                    <Badge variant="secondary" className="text-xs">
                      non-wheel
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span
                    className={`font-mono ${
                      trade.premium >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {trade.premium >= 0 ? "+" : ""}
                    {formatCurrency(trade.premium)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    CB: ${trade.runningCostBasis.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
