import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import type {
  MonthlyProfitResponse,
  MonthProfitView,
  MonthSummary,
  ImportBatch,
  Order,
} from "@assup/shared";
import { formatCurrency, formatDisplayName } from "@assup/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, ErrorAlert, PageLoadingSkeleton, ExternalLinks } from "@/components/common";
import { ImportDialog } from "@/components/profit/ImportDialog";
import { ClosePositionDialog } from "@/components/profit/ClosePositionDialog";
import { Sparkline } from "@/components/Sparkline";
import { ChartModal } from "@/components/ChartModal";
import { useSparklines } from "@/hooks/useSparklines";

// Helper to calculate days to expiration using US Eastern timezone
function calculateDTE(expiry: string): number {
  const eastern = (d: Date) => {
    const s = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    return new Date(s + "T00:00:00");
  };
  const todayET = eastern(new Date());
  const expiryDate = new Date(expiry + "T00:00:00");
  return Math.ceil((expiryDate.getTime() - todayET.getTime()) / (1000 * 60 * 60 * 24));
}

// Helper to format contract display name from trade data
function formatTradeDisplayName(trade: { underlying: string; strike: number; expiry: string; right: "C" | "P" }): string {
  // Convert YYYY-MM-DD to YYYYMMDD for formatDisplayName
  const expiryYYYYMMDD = trade.expiry.replace(/-/g, "");
  return formatDisplayName({
    symbol: trade.underlying,
    secType: "OPT",
    strike: trade.strike,
    right: trade.right,
    lastTradeDateOrContractMonth: expiryYYYYMMDD,
  });
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function ProfitPage() {
  const currentYear = new Date().getFullYear();
  const [monthlyData, setMonthlyData] = useState<MonthlyProfitResponse | null>(null);
  const [currentMonth, setCurrentMonth] = useState<MonthProfitView | null>(null);
  const [nextMonth, setNextMonth] = useState<MonthProfitView | null>(null);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [availableYears, setAvailableYears] = useState<number[]>([currentYear]);

  const loadData = useCallback(async (year: number) => {
    try {
      setLoading(true);
      // Calculate date range for the selected year
      const startDate = `${year}-01-01`;
      const endDate = year === currentYear
        ? new Date().toISOString().split("T")[0] // YTD for current year
        : `${year}-12-31`; // Full year for past years

      const [monthly, current, next, importList, yearsData] = await Promise.all([
        api.profit.monthly({ startDate, endDate }),
        api.profit.current(),
        api.profit.next(),
        api.profit.imports.list(),
        api.profit.years(),
      ]);
      setMonthlyData(monthly);
      setCurrentMonth(current);
      setNextMonth(next);
      setImports(importList.imports);
      setAvailableYears(yearsData.years);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [currentYear]);

  useEffect(() => {
    loadData(selectedYear);
  }, [loadData, selectedYear]);

  const handleImportComplete = useCallback(() => {
    loadData(selectedYear);
    setImportDialogOpen(false);
  }, [loadData, selectedYear]);

  const handleYearChange = useCallback((year: number) => {
    setSelectedYear(year);
  }, []);

  const toggleMonth = (key: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const formatMonthKey = (year: number, month: number) => `${year}-${month}`;

  if (loading && !monthlyData) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profit"
        subtitle="Track your options, stocks, dividends, and interest"
        loading={loading}
        onRefresh={() => loadData(selectedYear)}
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={selectedYear.toString()}
              onValueChange={(value) => handleYearChange(parseInt(value, 10))}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setImportDialogOpen(true)}>Import Data</Button>
          </div>
        }
      />

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {/* Summary Cards */}
      {monthlyData && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <SummaryCard
            label="Options"
            value={monthlyData.totals.optionsProfit}
            className="text-blue-600"
          />
          <SummaryCard
            label="Stocks"
            value={monthlyData.totals.stocksProfit}
            className="text-orange-600"
          />
          <SummaryCard
            label="Dividends"
            value={monthlyData.totals.dividends}
            className="text-green-600"
          />
          <SummaryCard
            label="Interest"
            value={monthlyData.totals.interest}
            className="text-purple-600"
          />
          <SummaryCard
            label="Taxes"
            value={monthlyData.totals.withholdingTax}
            className="text-red-600"
          />
          <SummaryCard
            label="Total"
            value={monthlyData.totals.total}
            className={monthlyData.totals.total >= 0 ? "text-green-600" : "text-red-600"}
          />
        </div>
      )}

      <Tabs defaultValue="current" className="space-y-4">
        <TabsList>
          <TabsTrigger value="current">Current Month</TabsTrigger>
          <TabsTrigger value="next">Next Month</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="imports">Imports</TabsTrigger>
        </TabsList>

        {/* Current Month Tab */}
        <TabsContent value="current" className="space-y-4">
          {currentMonth && <MonthProfitCard data={currentMonth} onSymbolClick={setChartSymbol} onDataRefresh={() => loadData(selectedYear)} />}
        </TabsContent>

        {/* Next Month Tab */}
        <TabsContent value="next" className="space-y-4">
          {nextMonth && <MonthProfitCard data={nextMonth} onSymbolClick={setChartSymbol} onDataRefresh={() => loadData(selectedYear)} />}
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          {monthlyData?.months.map((month) => {
            const key = formatMonthKey(month.year, month.month);
            const isExpanded = expandedMonths.has(key);

            return (
              <MonthHistoryCard
                key={key}
                month={month}
                isExpanded={isExpanded}
                onToggle={() => toggleMonth(key)}
              />
            );
          })}
          {(!monthlyData || monthlyData.months.length === 0) && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No historical data. Import your IBKR Flex Query to see profit history.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Imports Tab */}
        <TabsContent value="imports" className="space-y-4">
          <ImportsCard imports={imports} onDelete={() => loadData(selectedYear)} />
        </TabsContent>
      </Tabs>

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImportComplete={handleImportComplete}
      />

      <ChartModal
        symbol={chartSymbol}
        open={!!chartSymbol}
        onClose={() => setChartSymbol(null)}
      />
    </div>
  );
}

// Summary Card Component
function SummaryCard({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold ${className}`}>
          {formatCurrency(value)}
        </div>
      </CardContent>
    </Card>
  );
}

// Month Profit Card (for current/next month)
function MonthProfitCard({
  data,
  onSymbolClick,
  onDataRefresh,
}: {
  data: MonthProfitView;
  onSymbolClick: (symbol: string) => void;
  onDataRefresh?: () => void;
}) {
  const monthLabel = `${MONTH_NAMES[data.month - 1]} ${data.year}`;
  const [realizedExpanded, setRealizedExpanded] = useState(false);
  const [closePosition, setClosePosition] = useState<import("@assup/shared").CurrentOptionPosition | null>(null);
  const [existingOrderForDialog, setExistingOrderForDialog] = useState<Order | null>(null);
  const [openOrders, setOpenOrders] = useState<Order[]>([]);

  // Fetch open orders to match against expiring positions
  const loadOrders = useCallback(() => {
    api.orders.list()
      .then(setOpenOrders)
      .catch(() => setOpenOrders([]));
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Match a position to its existing BUY order
  const findMatchingOrder = useCallback((pos: import("@assup/shared").CurrentOptionPosition): Order | undefined => {
    // Match by displayName since both position and order use formatDisplayName
    return openOrders.find(
      (o) => o.action === "BUY" && o.secType === "OPT" && o.displayName === pos.displayName
    );
  }, [openOrders]);

  // Get unique underlying symbols for sparklines
  const sparklineSymbols = useMemo(() => {
    const symbols = new Set<string>();
    for (const pos of data.unrealized.positions) {
      symbols.add(pos.underlying);
    }
    return Array.from(symbols);
  }, [data.unrealized.positions]);

  const { getSparklineState } = useSparklines(sparklineSymbols);

  const hasRealizedTrades = data.realized.closedTrades.length > 0 ||
    data.realized.stockTrades.length > 0 ||
    data.realized.cashTransactions.length > 0;

  return (
    <div className="space-y-4">
      {/* Realized Profit Section */}
      <Collapsible open={realizedExpanded} onOpenChange={setRealizedExpanded}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{monthLabel} - Realized</CardTitle>
                <div className="flex items-center gap-4">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Options:</span>{" "}
                    <span className="text-blue-600">
                      {formatCurrency(data.realized.optionsProfit)}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Stocks:</span>{" "}
                    <span className="text-orange-600">
                      {formatCurrency(data.realized.stocksProfit)}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Div:</span>{" "}
                    <span className="text-green-600">{formatCurrency(data.realized.dividends)}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Int:</span>{" "}
                    <span className="text-purple-600">{formatCurrency(data.realized.interest)}</span>
                  </div>
                  <div className="text-sm font-semibold">
                    <span className="text-muted-foreground">Total:</span>{" "}
                    <span className={data.realized.total >= 0 ? "text-green-600" : "text-red-600"}>
                      {formatCurrency(data.realized.total)}
                    </span>
                  </div>
                  {data.realized.closedTrades.length > 0 && (
                    <Badge variant="secondary">{data.realized.closedTrades.length} opt trades</Badge>
                  )}
                  {data.realized.stockTrades.length > 0 && (
                    <Badge variant="secondary">{data.realized.stockTrades.length} stk trades</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {hasRealizedTrades ? (
                <div className="space-y-4">
                  {/* Closed Option Trades */}
                  {data.realized.closedTrades.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Option Trades</h4>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Contract</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Asset Class</TableHead>
                            <TableHead className="text-right">Premium</TableHead>
                            <TableHead className="text-right">Close Cost</TableHead>
                            <TableHead className="text-right">Profit</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...data.realized.closedTrades]
                            .sort((a, b) => {
                              const dateA = a.closeTrade?.tradeDate || a.expiry;
                              const dateB = b.closeTrade?.tradeDate || b.expiry;
                              return dateB.localeCompare(dateA); // Most recent first
                            })
                            .map((trade, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="text-muted-foreground">
                                {trade.closeTrade?.tradeDate || trade.expiry}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center">
                                  <a
                                    href={`https://www.tradingview.com/chart/?symbol=${trade.underlying}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium hover:text-primary hover:underline"
                                  >
                                    {formatTradeDisplayName(trade)}
                                  </a>
                                  <ExternalLinks symbol={trade.underlying} />
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={trade.right === "P" ? "danger" : "success"}>
                                  {trade.right === "P" ? "PUT" : "CALL"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {trade.assetClassName ? (
                                  <Link
                                    to={`/positions?assetClassId=${trade.assetClassId}`}
                                    className="flex items-center gap-2 hover:text-primary"
                                  >
                                    <div
                                      className="h-2 w-2 rounded-full shrink-0"
                                      style={{ backgroundColor: trade.assetClassColor }}
                                    />
                                    <span className="truncate text-sm">{trade.assetClassName}</span>
                                  </Link>
                                ) : (
                                  <span className="text-muted-foreground text-sm">-</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono text-green-600">
                                {formatCurrency(trade.costBasis)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {trade.sellPrice > 0 ? (
                                  <span className="text-red-600">{formatCurrency(trade.sellPrice)}</span>
                                ) : (
                                  <span className="text-muted-foreground">$0</span>
                                )}
                              </TableCell>
                              <TableCell
                                className={`text-right font-mono ${
                                  trade.profit >= 0 ? "text-green-600" : "text-red-600"
                                }`}
                              >
                                {formatCurrency(trade.profit)}
                              </TableCell>
                              <TableCell>
                                {trade.wasAssigned ? (
                                  <Badge variant="outline">Assigned</Badge>
                                ) : trade.expiredWorthless ? (
                                  <Badge variant="secondary">Expired</Badge>
                                ) : (
                                  <Badge variant="secondary">Closed</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* Stock Trades */}
                  {data.realized.stockTrades.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Stock Trades</h4>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Sell Date</TableHead>
                            <TableHead>Symbol</TableHead>
                            <TableHead>Asset Class</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Cost Basis</TableHead>
                            <TableHead className="text-right">Sell Proceeds</TableHead>
                            <TableHead className="text-right">Profit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...data.realized.stockTrades]
                            .sort((a, b) => {
                              const dateA = a.sellTrade?.tradeDate || "";
                              const dateB = b.sellTrade?.tradeDate || "";
                              return dateB.localeCompare(dateA); // Most recent first
                            })
                            .map((trade, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="text-muted-foreground">
                                {trade.sellTrade?.tradeDate || "-"}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center">
                                  <a
                                    href={`https://www.tradingview.com/chart/?symbol=${trade.symbol}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium hover:text-primary hover:underline"
                                  >
                                    {trade.symbol}
                                  </a>
                                  <ExternalLinks symbol={trade.symbol} />
                                </div>
                              </TableCell>
                              <TableCell>
                                {trade.assetClassName ? (
                                  <Link
                                    to={`/positions?assetClassId=${trade.assetClassId}`}
                                    className="flex items-center gap-2 hover:text-primary"
                                  >
                                    <div
                                      className="h-2 w-2 rounded-full shrink-0"
                                      style={{ backgroundColor: trade.assetClassColor }}
                                    />
                                    <span className="truncate text-sm">{trade.assetClassName}</span>
                                  </Link>
                                ) : (
                                  <span className="text-muted-foreground text-sm">-</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono">{trade.quantity}</TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(trade.costBasis)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(trade.sellProceeds)}
                              </TableCell>
                              <TableCell
                                className={`text-right font-mono ${
                                  trade.profit >= 0 ? "text-green-600" : "text-red-600"
                                }`}
                              >
                                {formatCurrency(trade.profit)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* Dividends */}
                  {data.realized.cashTransactions.filter(tx => tx.type === "DIVIDEND").length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Dividends</h4>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Symbol</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.realized.cashTransactions
                            .filter(tx => tx.type === "DIVIDEND")
                            .map((div) => (
                              <TableRow key={div.id}>
                                <TableCell>{div.transactionDate}</TableCell>
                                <TableCell className="font-medium">{div.symbol || "-"}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {div.description}
                                </TableCell>
                                <TableCell className="text-right text-green-600">
                                  {formatCurrency(div.amount)}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* Interest */}
                  {data.realized.cashTransactions.filter(tx => tx.type === "INTEREST").length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">Interest</h4>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.realized.cashTransactions
                            .filter(tx => tx.type === "INTEREST")
                            .map((int) => (
                              <TableRow key={int.id}>
                                <TableCell>{int.transactionDate}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {int.description}
                                </TableCell>
                                <TableCell className="text-right text-purple-600">
                                  {formatCurrency(int.amount)}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-4">
                  No realized trades yet this month
                </p>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle>{monthLabel} - Unrealized & Projected</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Unrealized P&L</div>
              <div
                className={`text-lg font-semibold ${
                  data.unrealized.value >= 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {formatCurrency(data.unrealized.value)}
              </div>
              <div className="text-xs text-muted-foreground">
                {data.unrealized.positions.length} positions expiring this month
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Projected Total</div>
              <div className="text-lg font-semibold text-blue-600">
                {formatCurrency(data.realized.total + data.projected.value)}
              </div>
              <div className="text-xs text-muted-foreground">
                if options expire worthless
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Expiring Positions */}
      {data.unrealized.positions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Expiring Positions
              <Badge variant="secondary">{data.unrealized.positions.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contract</TableHead>
                  <TableHead className="w-24"></TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Asset Class</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Strike</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">DTE</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unrealized P&L</TableHead>
                  <TableHead className="text-right">Projected</TableHead>
                  <TableHead className="text-right">Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.unrealized.positions.map((pos, idx) => {
                  const sparkline = getSparklineState(pos.underlying);
                  const dte = calculateDTE(pos.expiry);
                  const matchingOrder = findMatchingOrder(pos);
                  return (
                    <TableRow key={idx}>
                      <TableCell>
                        <div className="flex items-center">
                          <a
                            href={`https://www.tradingview.com/chart/?symbol=${pos.underlying}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:text-primary hover:underline"
                          >
                            {pos.displayName}
                          </a>
                          <ExternalLinks symbol={pos.underlying} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Sparkline
                          data={sparkline.data}
                          loading={sparkline.loading}
                          error={sparkline.error}
                          onChartClick={() => onSymbolClick(pos.underlying)}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant={pos.right === "P" ? "danger" : "success"}>
                          {pos.right === "P" ? "PUT" : "CALL"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {pos.assetClassName ? (
                          <Link
                            to={`/positions?assetClassId=${pos.assetClassId}`}
                            className="flex items-center gap-2 hover:text-primary"
                          >
                            <div
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: pos.assetClassColor }}
                            />
                            <span className="truncate text-sm">{pos.assetClassName}</span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {pos.underlyingPrice != null
                          ? `$${pos.underlyingPrice.toFixed(2)}`
                          : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${pos.strike.toFixed(pos.strike % 1 === 0 ? 0 : 2)}
                      </TableCell>
                      <TableCell>{pos.expiry}</TableCell>
                      <TableCell className={`text-right font-mono ${dte <= 7 ? "text-red-600" : ""}`}>
                        {dte}
                      </TableCell>
                      <TableCell className="text-right font-mono">{pos.quantity}</TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          pos.unrealizedPnl >= 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {formatCurrency(pos.unrealizedPnl)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-blue-600">
                        {formatCurrency(pos.projectedProfit)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {matchingOrder ? (
                          <span
                            className="cursor-pointer group/order relative"
                            onClick={() => {
                              setExistingOrderForDialog(matchingOrder);
                              setClosePosition(pos);
                            }}
                          >
                            {formatCurrency(matchingOrder.limitPrice ?? 0)} x {matchingOrder.quantity}
                            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/order:opacity-100 bg-background text-sm font-sans">
                              Adjust
                            </span>
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setExistingOrderForDialog(null);
                              setClosePosition(pos);
                            }}
                          >
                            Close
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ClosePositionDialog
        open={!!closePosition}
        onOpenChange={(open) => { if (!open) { setClosePosition(null); setExistingOrderForDialog(null); } }}
        position={closePosition}
        existingOrder={existingOrderForDialog}
        onOrderPlaced={() => { loadOrders(); onDataRefresh?.(); }}
      />
    </div>
  );
}

// Month History Card (expandable)
function MonthHistoryCard({
  month,
  isExpanded,
  onToggle,
}: {
  month: MonthSummary;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const monthLabel = `${MONTH_NAMES[month.month - 1]} ${month.year}`;

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{monthLabel}</CardTitle>
              <div className="flex items-center gap-4">
                <div className="text-sm">
                  <span className="text-muted-foreground">Options:</span>{" "}
                  <span className="text-blue-600">
                    {formatCurrency(month.optionsProfit)}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Stocks:</span>{" "}
                  <span className="text-orange-600">
                    {formatCurrency(month.stocksProfit)}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Div:</span>{" "}
                  <span className="text-green-600">
                    {formatCurrency(month.dividends)}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Int:</span>{" "}
                  <span className="text-purple-600">
                    {formatCurrency(month.interest)}
                  </span>
                </div>
                {month.withholdingTax !== 0 && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Tax:</span>{" "}
                    <span className="text-red-600">
                      {formatCurrency(month.withholdingTax)}
                    </span>
                  </div>
                )}
                {month.fees !== 0 && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Fees:</span>{" "}
                    <span className="text-red-600">
                      {formatCurrency(month.fees)}
                    </span>
                  </div>
                )}
                <div className="text-sm font-semibold">
                  <span className="text-muted-foreground">Total:</span>{" "}
                  <span
                    className={month.total >= 0 ? "text-green-600" : "text-red-600"}
                  >
                    {formatCurrency(month.total)}
                  </span>
                </div>
                <Badge variant="secondary">{month.tradeCount} opt</Badge>
                {month.stockTradeCount > 0 && (
                  <Badge variant="secondary">{month.stockTradeCount} stk</Badge>
                )}
                {month.assignedCount > 0 && (
                  <Badge variant="outline">{month.assignedCount} assigned</Badge>
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            <MonthDetailView year={month.year} month={month.month} />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// Month Detail View (loaded on expand)
function MonthDetailView({ year, month }: { year: number; month: number }) {
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof api.profit.monthDetail>
  > | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.profit
      .monthDetail(year, month)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [year, month]);

  if (loading) {
    return <div className="py-4 text-center text-muted-foreground">Loading...</div>;
  }

  if (!detail) {
    return <div className="py-4 text-center text-muted-foreground">No data</div>;
  }

  return (
    <div className="space-y-4">
      {/* Option Trades */}
      {detail.realized.optionTrades.length > 0 && (
        <div>
          <h4 className="font-medium mb-2">Option Trades</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Contract</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Asset Class</TableHead>
                <TableHead className="text-right">Premium</TableHead>
                <TableHead className="text-right">Close Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...detail.realized.optionTrades]
                .sort((a, b) => {
                  const dateA = a.closeTrade?.tradeDate || a.expiry;
                  const dateB = b.closeTrade?.tradeDate || b.expiry;
                  return dateB.localeCompare(dateA); // Most recent first
                })
                .map((trade, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-muted-foreground">
                    {trade.closeTrade?.tradeDate || trade.expiry}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center">
                      <a
                        href={`https://www.tradingview.com/chart/?symbol=${trade.underlying}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {formatTradeDisplayName(trade)}
                      </a>
                      <ExternalLinks symbol={trade.underlying} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={trade.right === "P" ? "danger" : "success"}>
                      {trade.right === "P" ? "PUT" : "CALL"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {trade.assetClassName ? (
                      <Link
                        to={`/positions?assetClassId=${trade.assetClassId}`}
                        className="flex items-center gap-2 hover:text-primary"
                      >
                        <div
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: trade.assetClassColor }}
                        />
                        <span className="truncate text-sm">{trade.assetClassName}</span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-green-600">
                    {formatCurrency(trade.costBasis)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {trade.sellPrice > 0 ? (
                      <span className="text-red-600">{formatCurrency(trade.sellPrice)}</span>
                    ) : (
                      <span className="text-muted-foreground">$0</span>
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono ${
                      trade.profit >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(trade.profit)}
                  </TableCell>
                  <TableCell>
                    {trade.wasAssigned ? (
                      <Badge variant="outline">Assigned</Badge>
                    ) : trade.expiredWorthless ? (
                      <Badge variant="secondary">Expired</Badge>
                    ) : (
                      <Badge variant="secondary">Closed</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Stock Trades */}
      {detail.realized.stockTrades.length > 0 && (
        <div>
          <h4 className="font-medium mb-2">Stock Trades</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sell Date</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Asset Class</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Cost Basis</TableHead>
                <TableHead className="text-right">Sell Proceeds</TableHead>
                <TableHead className="text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...detail.realized.stockTrades]
                .sort((a, b) => {
                  const dateA = a.sellTrade?.tradeDate || "";
                  const dateB = b.sellTrade?.tradeDate || "";
                  return dateB.localeCompare(dateA); // Most recent first
                })
                .map((trade, idx) => (
                <TableRow key={idx}>
                  <TableCell className="text-muted-foreground">
                    {trade.sellTrade?.tradeDate || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center">
                      <a
                        href={`https://www.tradingview.com/chart/?symbol=${trade.symbol}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {trade.symbol}
                      </a>
                      <ExternalLinks symbol={trade.symbol} />
                    </div>
                  </TableCell>
                  <TableCell>
                    {trade.assetClassName ? (
                      <Link
                        to={`/positions?assetClassId=${trade.assetClassId}`}
                        className="flex items-center gap-2 hover:text-primary"
                      >
                        <div
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: trade.assetClassColor }}
                        />
                        <span className="truncate text-sm">{trade.assetClassName}</span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{trade.quantity}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(trade.costBasis)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(trade.sellProceeds)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono ${
                      trade.profit >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatCurrency(trade.profit)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dividends */}
      {detail.realized.dividends.length > 0 && (
        <div>
          <h4 className="font-medium mb-2">Dividends</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.realized.dividends.map((div) => (
                <TableRow key={div.id}>
                  <TableCell>{div.transactionDate}</TableCell>
                  <TableCell className="font-medium">{div.symbol || "-"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {div.description}
                  </TableCell>
                  <TableCell className="text-right text-green-600">
                    {formatCurrency(div.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Interest */}
      {detail.realized.interest.length > 0 && (
        <div>
          <h4 className="font-medium mb-2">Interest</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.realized.interest.map((int) => (
                <TableRow key={int.id}>
                  <TableCell>{int.transactionDate}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {int.description}
                  </TableCell>
                  <TableCell className="text-right text-purple-600">
                    {formatCurrency(int.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Withholding Tax */}
      {detail.realized.withholdingTax.length > 0 && (
        <div>
          <h4 className="font-medium mb-2">Withholding Tax</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.realized.withholdingTax.map((tax) => (
                <TableRow key={tax.id}>
                  <TableCell>{tax.transactionDate}</TableCell>
                  <TableCell className="font-medium">{tax.symbol || "-"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {tax.description}
                  </TableCell>
                  <TableCell className="text-right text-red-600">
                    {formatCurrency(tax.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Fees */}
      {detail.realized.fees.length > 0 && (
        <div>
          <h4 className="font-medium mb-2">Fees</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.realized.fees.map((fee) => (
                <TableRow key={fee.id}>
                  <TableCell>{fee.transactionDate}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {fee.description}
                  </TableCell>
                  <TableCell className="text-right text-red-600">
                    {formatCurrency(fee.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// Imports Card
function ImportsCard({
  imports,
  onDelete,
}: {
  imports: ImportBatch[];
  onDelete: () => void;
}) {
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this import and all associated data?")) return;
    try {
      await api.profit.imports.delete(id);
      onDelete();
    } catch (err) {
      console.error("Failed to delete import:", err);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Import History
          <Badge variant="secondary">{imports.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {imports.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No imports yet. Click "Import Data" to upload your IBKR Flex Query.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filename</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead>Imported</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((imp) => (
                <TableRow key={imp.id}>
                  <TableCell className="font-medium">{imp.filename}</TableCell>
                  <TableCell>
                    {imp.periodStart} - {imp.periodEnd}
                  </TableCell>
                  <TableCell className="text-right">{imp.recordCount}</TableCell>
                  <TableCell>{new Date(imp.importedAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(imp.id)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
