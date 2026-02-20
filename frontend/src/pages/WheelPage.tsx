import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";
import type {
  WheelListResponse,
  WheelTickerSummary,
  WheelSuggestion,
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

  // Filter cycles to show only those started within the last year
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const oneYearAgoStr = oneYearAgo.toISOString().split("T")[0];
  const recentCycles = detail.cycles.filter((cycle) => cycle.startDate >= oneYearAgoStr);

  return (
    <div className="space-y-4">
      {/* Cycle Summary Cards */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {recentCycles.map((cycle) => (
          <Card
            key={cycle.cycleNumber}
            className={`min-w-[220px] ${
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

      {/* Contract Lifecycles (for current/last cycle) */}
      {recentCycles.length > 0 && (
        <ContractLifecycleView cycle={recentCycles[recentCycles.length - 1]} symbol={symbol} />
      )}
    </div>
  );
}

// Types for grouped contract view
interface ContractLifecycle {
  id: string;
  type: "PUT" | "CALL" | "SHARES";
  strike: number | null;
  expiry: string | null;
  openDate: string;
  closeDate: string | null;
  outcome: "expired" | "bought_back" | "assigned" | "called_away" | "sold" | "open";
  openPremium: number;
  closePremium: number;
  netPnL: number;
  costBasisAfter: number;
  quantity: number;
  // For assigned/called_away: info about the stock transaction
  stockTransaction?: {
    action: "bought" | "sold";
    shares: number;
    price: number;
  };
}

function groupTradesIntoContracts(trades: import("@assup/shared").WheelTrade[]): ContractLifecycle[] {
  const contracts: ContractLifecycle[] = [];
  const usedTradeIds = new Set<string>();

  // Process option sells first (SOLD_PUT, SOLD_CALL)
  for (const trade of trades) {
    if (usedTradeIds.has(trade.id)) continue;

    if (trade.type === "SOLD_PUT" || trade.type === "SOLD_CALL") {
      const isPut = trade.type === "SOLD_PUT";
      usedTradeIds.add(trade.id);

      // Find matching close trade (same strike and expiry)
      const closeTrade = trades.find((t) => {
        if (usedTradeIds.has(t.id)) return false;
        if (t.strike !== trade.strike || t.expiry !== trade.expiry) return false;

        if (isPut) {
          return t.type === "BOUGHT_PUT" || t.type === "EXPIRED" || t.type === "ASSIGNED";
        } else {
          return t.type === "BOUGHT_CALL" || t.type === "EXPIRED" || t.type === "CALLED_AWAY";
        }
      });

      let outcome: ContractLifecycle["outcome"] = "open";
      let closePremium = 0;
      let closeDate: string | null = null;
      let costBasisAfter = trade.runningCostBasis;

      let stockTransaction: ContractLifecycle["stockTransaction"];

      if (closeTrade) {
        usedTradeIds.add(closeTrade.id);
        closeDate = closeTrade.tradeDate;
        costBasisAfter = closeTrade.runningCostBasis;

        if (closeTrade.type === "BOUGHT_PUT" || closeTrade.type === "BOUGHT_CALL") {
          outcome = "bought_back";
          closePremium = closeTrade.premium; // Buyback cost counts as P&L
        } else if (closeTrade.type === "EXPIRED") {
          outcome = "expired";
          // closePremium stays 0 - full premium kept
        } else if (closeTrade.type === "ASSIGNED") {
          outcome = "assigned";
          // Stock purchase is NOT P&L - it's acquiring an asset
          // closePremium stays 0 - option premium is the only P&L
          stockTransaction = {
            action: "bought",
            shares: closeTrade.quantity,
            price: trade.strike || 0,
          };
        } else if (closeTrade.type === "CALLED_AWAY") {
          outcome = "called_away";
          // Stock sale is NOT option P&L - it's disposing an asset
          // closePremium stays 0 - option premium is the only P&L
          stockTransaction = {
            action: "sold",
            shares: closeTrade.quantity,
            price: trade.strike || 0,
          };
        }
      }

      contracts.push({
        id: trade.id,
        type: isPut ? "PUT" : "CALL",
        strike: trade.strike,
        expiry: trade.expiry,
        openDate: trade.tradeDate,
        closeDate,
        outcome,
        openPremium: trade.premium,
        closePremium,
        netPnL: trade.premium + closePremium,
        costBasisAfter,
        quantity: trade.quantity,
        stockTransaction,
      });
    }
  }

  // Process stock trades (BOUGHT_SHARES, SOLD_SHARES)
  for (const trade of trades) {
    if (usedTradeIds.has(trade.id)) continue;

    if (trade.type === "BOUGHT_SHARES") {
      usedTradeIds.add(trade.id);
      contracts.push({
        id: trade.id,
        type: "SHARES",
        strike: null,
        expiry: null,
        openDate: trade.tradeDate,
        closeDate: null,
        outcome: "open",
        openPremium: trade.premium, // negative for purchase
        closePremium: 0,
        netPnL: trade.premium,
        costBasisAfter: trade.runningCostBasis,
        quantity: trade.quantity,
      });
    } else if (trade.type === "SOLD_SHARES") {
      usedTradeIds.add(trade.id);
      contracts.push({
        id: trade.id,
        type: "SHARES",
        strike: null,
        expiry: null,
        openDate: trade.tradeDate,
        closeDate: trade.tradeDate,
        outcome: "sold",
        openPremium: 0,
        closePremium: trade.premium,
        netPnL: trade.premium,
        costBasisAfter: trade.runningCostBasis,
        quantity: trade.quantity,
      });
    }
  }

  // Sort by open date
  return contracts.sort((a, b) => a.openDate.localeCompare(b.openDate));
}

function ContractLifecycleView({ cycle, symbol }: { cycle: import("@assup/shared").WheelCycle; symbol: string }) {
  const contracts = groupTradesIntoContracts(cycle.trades);

  const outcomeLabels: Record<ContractLifecycle["outcome"], string> = {
    expired: "Expired",
    bought_back: "Bought Back",
    assigned: "Assigned",
    called_away: "Called Away",
    sold: "Sold",
    open: "Open",
  };

  const outcomeColors: Record<ContractLifecycle["outcome"], string> = {
    expired: "bg-green-100 text-green-800",
    bought_back: "bg-yellow-100 text-yellow-800",
    assigned: "bg-blue-100 text-blue-800",
    called_away: "bg-purple-100 text-purple-800",
    sold: "bg-gray-100 text-gray-800",
    open: "bg-blue-100 text-blue-800",
  };

  // Format contract name like "TLT Jan30'26 89 CALL"
  const formatContractName = (contract: ContractLifecycle): string => {
    if (contract.type === "SHARES") {
      return `${contract.quantity} shares`;
    }
    if (contract.strike && contract.expiry) {
      // Convert YYYY-MM-DD to YYYYMMDD for formatDisplayName
      const expiryYYYYMMDD = contract.expiry.replace(/-/g, "");
      return formatDisplayName({
        symbol,
        secType: "OPT",
        strike: contract.strike,
        right: contract.type === "PUT" ? "P" : "C",
        lastTradeDateOrContractMonth: expiryYYYYMMDD,
      });
    }
    return symbol;
  };

  return (
    <div>
      <h4 className="font-medium mb-2">
        Contracts (Cycle {cycle.cycleNumber})
      </h4>
      <div className="space-y-2">
        {contracts.map((contract) => (
          <div
            key={contract.id}
            className="flex items-center justify-between p-3 rounded bg-muted"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">
                {formatContractName(contract)}
              </span>
              <span className="text-sm text-muted-foreground">
                {contract.openDate}
                {contract.closeDate && contract.closeDate !== contract.openDate && (
                  <> → {contract.closeDate}</>
                )}
              </span>
              <Badge className={outcomeColors[contract.outcome]}>
                {outcomeLabels[contract.outcome]}
              </Badge>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Premium</div>
                <span
                  className={`font-mono font-medium ${
                    contract.netPnL >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {contract.netPnL >= 0 ? "+" : ""}
                  {formatCurrency(contract.netPnL)}
                </span>
              </div>
              {contract.stockTransaction ? (
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">
                    {contract.stockTransaction.action === "bought" ? "Bought" : "Sold"}
                  </div>
                  <span className="font-mono text-sm">
                    {contract.stockTransaction.shares} @ ${contract.stockTransaction.price.toFixed(0)}
                  </span>
                </div>
              ) : (
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Cost Basis</div>
                  <span className="font-mono text-sm">
                    ${contract.costBasisAfter.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
        {contracts.length === 0 && (
          <div className="text-center text-muted-foreground py-4">
            No contracts in this cycle
          </div>
        )}
      </div>
    </div>
  );
}
