import { useState, useEffect, useCallback } from "react";
import { researchApi } from "@/api";
import type {
  ResearchTicker,
  ResearchReport,
  MacroAnalysis,
  MarketRegime,
  AnalysisResult,
} from "@assup/shared";
import {
  ErrorAlert,
  PageLoadingSkeleton,
  PageHeader,
  RecommendationBadge,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ListRestart, Eye, Zap, AlertTriangle } from "lucide-react";

// --- Helpers ---

function timeAgo(dateStr: string): string {
  const hours = Math.round(
    (Date.now() - new Date(dateStr).getTime()) / 3600000
  );
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

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

// --- Macro Banner ---

function MacroBanner({ macro }: { macro: MacroAnalysis | null }) {
  if (!macro) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-3 px-4">
          <p className="text-sm text-muted-foreground">
            No macro data available. Generate a macro analysis to see the market
            regime.
          </p>
        </CardContent>
      </Card>
    );
  }

  const config = regimeConfig[macro.regime];

  return (
    <Card className={`${config.bg} ${config.border} border`}>
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className={`${config.text} ${config.border} font-semibold`}
            >
              {config.label}
            </Badge>
            <span className="text-sm font-medium">
              {Math.round(macro.confidence * 100)}% confidence
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              VIX: <span className="font-medium">{macro.details.vix}</span> (
              {macro.details.vixTrend})
            </span>
            <span>S&P 500: {macro.details.sp500Trend}</span>
            <span>Updated {timeAgo(macro.analyzedAt)}</span>
          </div>
        </div>
        {macro.summary && (
          <p className="text-sm mt-2 text-muted-foreground">{macro.summary}</p>
        )}
      </CardContent>
    </Card>
  );
}

// --- Report Detail Dialog ---

interface ReportDetailProps {
  open: boolean;
  onClose: () => void;
  symbol: string;
  report: ResearchReport | null;
  analyses: AnalysisResult[];
  loading: boolean;
}

const signalColors: Record<string, string> = {
  bullish: "text-green-700",
  bearish: "text-red-700",
  neutral: "text-amber-700",
};

function ReportDetailDialog({
  open,
  onClose,
  symbol,
  report,
  analyses,
  loading,
}: ReportDetailProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="text-xl">{symbol}</span>
            {report && (
              <RecommendationBadge
                recommendation={report.recommendation}
                confidence={report.confidence}
              />
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Research report details for {symbol}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">
            Loading report...
          </div>
        ) : !report ? (
          <div className="py-8 text-center text-muted-foreground">
            No report available for {symbol}. Click "Generate" to create one.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div>
              <h3 className="text-sm font-semibold mb-1">Summary</h3>
              <p className="text-sm text-muted-foreground">{report.summary}</p>
            </div>

            {/* Full Report */}
            <div>
              <h3 className="text-sm font-semibold mb-1">Full Report</h3>
              <div className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-3 max-h-64 overflow-y-auto">
                {report.fullReport}
              </div>
            </div>

            {/* Signal Breakdown */}
            {analyses.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-1">Signal Breakdown</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Signal</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Summary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analyses.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium capitalize">
                          {a.source.replace(/_/g, " ")}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`capitalize font-medium ${signalColors[a.signal] || ""}`}
                          >
                            {a.signal}
                          </span>
                        </TableCell>
                        <TableCell>
                          {Math.round(a.confidence * 100)}%
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-48 truncate">
                          {a.summary}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Generated {timeAgo(report.createdAt)}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Main Page ---

export function ResearchPage() {
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

  // Detail dialog state
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const [detailReport, setDetailReport] = useState<ResearchReport | null>(null);
  const [detailAnalyses, setDetailAnalyses] = useState<AnalysisResult[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

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
    setError(null);
    try {
      const { jobId } = await researchApi.generate(symbol);

      // Poll job status until complete
      const maxAttempts = 60; // 5 minutes at 5s intervals
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const job = await researchApi.getJob(jobId);

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
    }
  }

  async function handleViewDetail(symbol: string) {
    setDetailSymbol(symbol);
    setDetailLoading(true);
    setDetailReport(null);
    setDetailAnalyses([]);

    try {
      const [reportResult, analysisResult] = await Promise.allSettled([
        researchApi.getReport(symbol),
        researchApi.getAnalysis(symbol),
      ]);

      if (reportResult.status === "fulfilled") {
        setDetailReport(reportResult.value);
      }
      if (analysisResult.status === "fulfilled") {
        setDetailAnalyses(analysisResult.value.analyses);
      }
    } catch {
      // Errors are handled by showing empty state in dialog
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetailSymbol(null);
    setDetailReport(null);
    setDetailAnalyses([]);
  }

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
      <MacroBanner macro={macro} />

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
                  <TableHead>Symbol</TableHead>
                  <TableHead>Recommendation</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead className="hidden md:table-cell">
                    Summary
                  </TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickers.map((ticker) => {
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
                        {report ? (
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
                            onClick={() => handleViewDetail(ticker.symbol)}
                            disabled={!report}
                            title="View report"
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
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

      {/* Report Detail Dialog */}
      <ReportDetailDialog
        open={detailSymbol !== null}
        onClose={closeDetail}
        symbol={detailSymbol || ""}
        report={detailReport}
        analyses={detailAnalyses}
        loading={detailLoading}
      />
    </div>
  );
}
