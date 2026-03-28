import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { researchApi, settingsApi } from "@/api";
import type {
  ResearchTicker,
  ResearchReport,
  MacroAnalysis,
  MarketRegime,
} from "@assup/shared";
import {
  ErrorAlert,
  PageLoadingSkeleton,
  PageHeader,
  RecommendationBadge,
  SortableHead,
} from "@/components/common";
import { useTableSort } from "@/hooks/useTableSort";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ListRestart, Eye, Zap, AlertTriangle, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { timeAgo } from "@/utils/format";

// --- Helpers ---

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "...";
}

const regimeConfig: Record<
  MarketRegime,
  { label: string; bg: string; text: string; border: string }
> = {
  risk_on: {
    label: "Risk On",
    bg: "bg-green-500/10",
    text: "text-green-700",
    border: "border-green-500/20",
  },
  risk_off: {
    label: "Risk Off",
    bg: "bg-red-500/10",
    text: "text-red-700",
    border: "border-red-500/20",
  },
  neutral: {
    label: "Neutral",
    bg: "bg-amber-500/10",
    text: "text-amber-700",
    border: "border-amber-500/20",
  },
};

// --- Fear Score ---

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Linearly map value from [inLow, inHigh] to [outLow, outHigh], clamped. */
function linearMap(v: number, inLow: number, inHigh: number, outLow: number, outHigh: number): number {
  return clamp(outLow + ((v - inLow) / (inHigh - inLow)) * (outHigh - outLow), Math.min(outLow, outHigh), Math.max(outLow, outHigh));
}

interface FearScoreResult {
  score: number;
  label: string;
  components: { name: string; display: string; change?: number | null }[];
}

function computeFearScore(details: MacroAnalysis["details"]): FearScoreResult | null {
  const signals: { score: number; weight: number; name: string; display: string; change?: number | null }[] = [];

  // VIX level: 0 (greed) at ≤12, 50 at 20, 100 (fear) at ≥35
  if (details.vix != null) {
    const s = details.vix <= 20
      ? linearMap(details.vix, 12, 20, 0, 50)
      : linearMap(details.vix, 20, 35, 50, 100);
    signals.push({ score: s, weight: 0.30, name: "VIX", display: details.vix.toFixed(1), change: details.vixChange });
  }

  // VIX vs SMA20: 0 when 15%+ below, 50 at parity, 100 when 15%+ above
  if (details.vix != null && details.vixSma20 != null && details.vixSma20 > 0) {
    const pctDiff = ((details.vix - details.vixSma20) / details.vixSma20) * 100;
    const s = linearMap(pctDiff, -15, 15, 0, 100);
    signals.push({ score: s, weight: 0.10, name: "", display: "" }); // weight participates but no separate display
  }

  // S&P vs SMA200: 0 when 10%+ above, 50 at parity, 100 when 10%+ below (inverted)
  if (details.sp500Index != null && details.sp500Sma200 != null && details.sp500Sma200 > 0) {
    const pctAbove = ((details.sp500Index - details.sp500Sma200) / details.sp500Sma200) * 100;
    const s = linearMap(pctAbove, 10, -10, 0, 100);
    const displayPrice = details.sp500Index.toLocaleString("en-US", { maximumFractionDigits: 0 });
    signals.push({ score: s, weight: 0.15, name: "S&P 500", display: displayPrice, change: details.sp500Change });
  }

  // S&P 500 RSI: RSI 70→30 maps to 0→100 fear (high RSI = greed, low RSI = fear)
  if (details.sp500Rsi != null) {
    const s = linearMap(details.sp500Rsi, 70, 30, 0, 100);
    signals.push({ score: s, weight: 0.10, name: "RSI", display: details.sp500Rsi.toFixed(0) });
  }

  // Safe haven demand: HYG-TLT spread. +3→-3 maps to 0→100 fear
  if (details.safeHavenSpread != null) {
    const s = linearMap(details.safeHavenSpread, 3, -3, 0, 100);
    signals.push({ score: s, weight: 0.15, name: "HYG/TLT", display: `${details.safeHavenSpread >= 0 ? "+" : ""}${details.safeHavenSpread.toFixed(1)}%` });
  }

  // Market momentum: SPX daily change. +2→-2 maps to 0→100 fear
  if (details.sp500Change != null) {
    const s = linearMap(details.sp500Change, 2, -2, 0, 100);
    signals.push({ score: s, weight: 0.10, name: "Momentum", display: `${details.sp500Change >= 0 ? "+" : ""}${details.sp500Change.toFixed(1)}%` });
  }

  // Put/Call ratio: 0 at ≤0.5, 50 at 0.85, 100 at ≥1.5
  if (details.putCallRatio != null) {
    const s = details.putCallRatio <= 0.85
      ? linearMap(details.putCallRatio, 0.5, 0.85, 0, 50)
      : linearMap(details.putCallRatio, 0.85, 1.5, 50, 100);
    signals.push({ score: s, weight: 0.10, name: "P/C", display: details.putCallRatio.toFixed(2) });
  }

  if (signals.length === 0) return null;

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = signals.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight;

  const label =
    score < 20 ? "Extreme Greed" :
    score < 40 ? "Greed" :
    score < 60 ? "Neutral" :
    score < 80 ? "Fear" :
    "Extreme Fear";

  return {
    score: Math.round(score),
    label,
    components: signals.filter((s) => s.name).map((s) => ({ name: s.name, display: s.display, change: s.change })),
  };
}

function DailyChangeArrow({ change }: { change: number }) {
  const threshold = 0.05;
  if (Math.abs(change) < threshold) {
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  if (change > 0) {
    return (
      <span className="inline-flex items-center text-green-600">
        <TrendingUp className="h-3.5 w-3.5" />
        <span className="text-xs font-medium ml-0.5">+{change.toFixed(1)}%</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-red-600">
      <TrendingDown className="h-3.5 w-3.5" />
      <span className="text-xs font-medium ml-0.5">{change.toFixed(1)}%</span>
    </span>
  );
}

function FearGauge({ details }: { details: MacroAnalysis["details"] }) {
  const result = computeFearScore(details);
  if (!result) return <span className="text-xs text-muted-foreground">No data</span>;

  const labelColor =
    result.score < 20 ? "text-green-600" :
    result.score < 40 ? "text-green-500" :
    result.score < 60 ? "text-amber-500" :
    result.score < 80 ? "text-orange-500" :
    "text-red-600";

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 min-w-[180px]">
        <span className={`text-lg font-bold tabular-nums ${labelColor}`}>{result.score}</span>
        <div className="relative flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "linear-gradient(to right, #22c55e, #eab308, #f97316, #ef4444)" }}>
          <div
            className="absolute top-[-1px] w-[3px] h-[12px] bg-white rounded-full border border-gray-500"
            style={{ left: `${result.score}%`, transform: "translateX(-50%)" }}
          />
        </div>
        <span className={`text-sm font-semibold whitespace-nowrap ${labelColor}`}>{result.label}</span>
      </div>
      <div className="hidden lg:flex items-center gap-4 text-sm text-muted-foreground">
        {result.components.map((c) => (
          <span key={c.name} className="flex items-center gap-1">
            {c.name}: <span className="font-semibold">{c.display}</span>
            {c.change != null && <DailyChangeArrow change={c.change} />}
          </span>
        ))}
      </div>
    </div>
  );
}

// --- Macro Banner ---

function MacroBanner({
  macro,
  onRefresh,
}: {
  macro: MacroAnalysis | null;
  onRefresh: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  if (!macro) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-3 px-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            No macro data available.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Generate"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const config = regimeConfig[macro.regime];

  return (
    <Card className={`${config.bg} ${config.border} border`}>
      <CardContent className="py-4 px-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Badge
              variant="outline"
              className={`${config.text} ${config.border} font-semibold text-sm px-3 py-0.5`}
            >
              {config.label}
            </Badge>
            <FearGauge details={macro.details} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Updated {timeAgo(macro.analyzedAt)}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh macro data"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Main Page ---

export function ResearchPage() {
  const navigate = useNavigate();
  const [tickers, setTickers] = useState<ResearchTicker[]>([]);
  const [reports, setReports] = useState<Record<string, ResearchReport>>({});
  const [macro, setMacro] = useState<MacroAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Generate state
  const [generatingSymbol, setGeneratingSymbol] = useState<string | null>(null);
  const [generateProgress, setGenerateProgress] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tickerData, macroData] = await Promise.allSettled([
        researchApi.listTickers(),
        researchApi.getMacro(),
      ]);

      if (tickerData.status === "fulfilled") {
        setTickers(tickerData.value.tickers);

        // Fetch latest report for each ticker (best-effort)
        const reportResults = await Promise.allSettled(
          tickerData.value.tickers.map((t) => researchApi.getReport(t.symbol))
        );
        const reportMap: Record<string, ResearchReport> = {};
        reportResults.forEach((result, idx) => {
          if (result.status === "fulfilled" && result.value) {
            reportMap[tickerData.value.tickers[idx].symbol] = result.value;
          }
        });
        setReports(reportMap);
      } else {
        setError(
          tickerData.reason instanceof Error
            ? tickerData.reason.message
            : "Failed to load tickers"
        );
      }

      if (macroData.status === "fulfilled") {
        setMacro(macroData.value);
      }
      // Macro data may simply not exist yet -- that's fine
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load research data"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const result = await researchApi.syncWatchlist();
      setSyncResult(
        `Synced ${result.synced} ticker${result.synced !== 1 ? "s" : ""}, skipped ${result.skipped}`
      );
      // Refresh tickers after sync
      await fetchData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to sync watchlist"
      );
    } finally {
      setSyncing(false);
    }
  }

  async function handleGenerate(symbol: string) {
    setGeneratingSymbol(symbol);
    setGenerateProgress(null);
    setError(null);
    try {
      const researchSettings = await settingsApi
        .get<{ synthesizerMode: string }>("research")
        .then((r) => r.value)
        .catch(() => ({ synthesizerMode: undefined }));

      const { jobId } = await researchApi.generate(symbol, {
        force: true,
        mode: researchSettings.synthesizerMode,
      });

      // Poll job status until complete
      const maxAttempts = 150; // 5 minutes at 2s intervals
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const job = await researchApi.getJob(jobId);

        if (job.progress) {
          setGenerateProgress(job.progress);
        }

        if (job.status === "completed") {
          const report = await researchApi.getReport(symbol);
          setReports((prev) => ({ ...prev, [symbol]: report }));
          return;
        }

        if (job.status === "failed") {
          setError(job.error || `Report generation failed for ${symbol}`);
          return;
        }
      }

      setError(`Report generation timed out for ${symbol}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to generate report for ${symbol}`
      );
    } finally {
      setGeneratingSymbol(null);
      setGenerateProgress(null);
    }
  }

  const recOrder: Record<string, number> = { buy: 0, wheel: 1, hold: 2, avoid: 3, sell: 4 };

  const getColumnValue = useCallback(
    (ticker: ResearchTicker, column: string): string | number => {
      const report = reports[ticker.symbol];
      switch (column) {
        case "symbol":
          return ticker.symbol;
        case "recommendation":
          return report ? (recOrder[report.recommendation] ?? 99) : 99;
        case "confidence":
          return report ? report.confidence : -1;
        case "updated":
          return report
            ? new Date(report.createdAt).getTime()
            : ticker.lastAnalyzed
              ? new Date(ticker.lastAnalyzed).getTime()
              : 0;
        default:
          return "";
      }
    },
    [reports],
  );

  const { sorted: sortedTickers, ...sortProps } = useTableSort(tickers, getColumnValue);

  if (loading) return <PageLoadingSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Research"
        subtitle="AI-powered analysis and recommendations for tracked securities."
        loading={loading}
        onRefresh={fetchData}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
          >
            <ListRestart
              className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing..." : "Sync Watchlist"}
          </Button>
        }
      />

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {syncResult && (
        <div className="rounded-md border border-green-500/20 bg-green-500/10 px-4 py-2 text-sm text-green-700 flex items-center justify-between">
          <span>{syncResult}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => setSyncResult(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Macro Regime Banner */}
      <MacroBanner
        macro={macro}
        onRefresh={async () => {
          const snapshot = await researchApi.refreshMacro();
          setMacro(snapshot);
        }}
      />

      {/* Tickers Table */}
      <Card>
        <CardContent className="p-0">
          {tickers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No tickers tracked yet</p>
              <p className="text-sm mt-1">
                Click "Sync Watchlist" to import tickers from your watchlists.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead column="symbol" {...sortProps}>Symbol</SortableHead>
                  <SortableHead column="recommendation" {...sortProps}>Recommendation</SortableHead>
                  <SortableHead column="confidence" {...sortProps}>Confidence</SortableHead>
                  <TableHead className="hidden md:table-cell">
                    Summary
                  </TableHead>
                  <SortableHead column="updated" {...sortProps}>Last Updated</SortableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTickers.map((ticker) => {
                  const report = reports[ticker.symbol];
                  return (
                    <TableRow key={ticker.id}>
                      <TableCell className="font-semibold">
                        {ticker.symbol}
                      </TableCell>
                      <TableCell>
                        {report ? (
                          <RecommendationBadge
                            recommendation={report.recommendation}
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            No report
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {report ? (
                          <span className="text-sm">
                            {Math.round(report.confidence * 100)}%
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            --
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell max-w-xs">
                        {generatingSymbol === ticker.symbol && generateProgress ? (
                          <span className="text-sm text-blue-600 animate-pulse">
                            {generateProgress}
                          </span>
                        ) : report ? (
                          <span className="text-sm text-muted-foreground">
                            {truncate(report.summary, 80)}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            --
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {report
                            ? timeAgo(report.createdAt)
                            : ticker.lastAnalyzed
                              ? timeAgo(ticker.lastAnalyzed)
                              : "Never"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/research/${ticker.symbol}`)}
                            disabled={!report && !ticker.lastAnalyzed}
                            title="View report"
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-[120px]"
                            onClick={() => handleGenerate(ticker.symbol)}
                            disabled={generatingSymbol === ticker.symbol}
                            title="Generate report"
                          >
                            <Zap
                              className={`h-4 w-4 mr-1 ${generatingSymbol === ticker.symbol ? "animate-pulse" : ""}`}
                            />
                            {generatingSymbol === ticker.symbol
                              ? "Generating..."
                              : "Generate"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
