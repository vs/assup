import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { researchApi, watchlistsApi, settingsApi } from "@/api";
import type {
  ResearchTicker,
  ResearchReport,
  MacroAnalysis,
  MarketRegime,
  Watchlist,
  WatchlistWithItems,
  ScanRun,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Eye,
  Zap,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronRight,
  Radar,
  Trash2,
  GripVertical,
  List,
} from "lucide-react";
import { timeAgo } from "@/utils/format";
import { ScannerDialog } from "@/components/research/ScannerDialog";

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

  if (details.vix != null) {
    const s = details.vix <= 20
      ? linearMap(details.vix, 12, 20, 0, 50)
      : linearMap(details.vix, 20, 35, 50, 100);
    signals.push({ score: s, weight: 0.30, name: "VIX", display: details.vix.toFixed(1), change: details.vixChange });
  }

  if (details.vix != null && details.vixSma20 != null && details.vixSma20 > 0) {
    const pctDiff = ((details.vix - details.vixSma20) / details.vixSma20) * 100;
    const s = linearMap(pctDiff, -15, 15, 0, 100);
    signals.push({ score: s, weight: 0.10, name: "", display: "" });
  }

  if (details.sp500Index != null && details.sp500Sma200 != null && details.sp500Sma200 > 0) {
    const pctAbove = ((details.sp500Index - details.sp500Sma200) / details.sp500Sma200) * 100;
    const s = linearMap(pctAbove, 10, -10, 0, 100);
    const displayPrice = details.sp500Index.toLocaleString("en-US", { maximumFractionDigits: 0 });
    signals.push({ score: s, weight: 0.15, name: "S&P 500", display: displayPrice, change: details.sp500Change });
  }

  if (details.sp500Rsi != null) {
    const s = linearMap(details.sp500Rsi, 70, 30, 0, 100);
    signals.push({ score: s, weight: 0.10, name: "RSI", display: details.sp500Rsi.toFixed(0) });
  }

  if (details.safeHavenSpread != null) {
    const s = linearMap(details.safeHavenSpread, 3, -3, 0, 100);
    signals.push({ score: s, weight: 0.15, name: "HYG/TLT", display: `${details.safeHavenSpread >= 0 ? "+" : ""}${details.safeHavenSpread.toFixed(1)}%` });
  }

  if (details.sp500Change != null) {
    const s = linearMap(details.sp500Change, 2, -2, 0, 100);
    signals.push({ score: s, weight: 0.10, name: "Momentum", display: `${details.sp500Change >= 0 ? "+" : ""}${details.sp500Change.toFixed(1)}%` });
  }

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

function MacroBanner({ macro }: { macro: MacroAnalysis | null }) {
  if (!macro) return null;

  const config = regimeConfig[macro.regime];

  return (
    <Card className={`${config.bg} ${config.border} border`}>
      <CardContent className="py-4 px-5">
        <div className="flex items-center gap-4">
          <Badge
            variant="outline"
            className={`${config.text} ${config.border} font-semibold text-sm px-3 py-0.5`}
          >
            {config.label}
          </Badge>
          <FearGauge details={macro.details} />
        </div>
      </CardContent>
    </Card>
  );
}

// --- Ticker Row (draggable) ---

function TickerRow({
  symbol,
  report,
  generatingSymbol,
  generateProgress,
  onView,
  onGenerate,
  onDelete,
  draggable,
}: {
  symbol: string;
  report: ResearchReport | undefined;
  generatingSymbol: string | null;
  generateProgress: string | null;
  onView: () => void;
  onGenerate: () => void;
  onDelete: () => void;
  draggable?: boolean;
}) {
  return (
    <TableRow
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", symbol);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={draggable ? "cursor-grab active:cursor-grabbing" : ""}
    >
      {draggable && (
        <TableCell className="w-8 px-2">
          <GripVertical className="h-4 w-4 text-muted-foreground/40" />
        </TableCell>
      )}
      <TableCell className="font-semibold">{symbol}</TableCell>
      <TableCell>
        {report ? (
          <RecommendationBadge recommendation={report.recommendation} />
        ) : (
          <span className="text-sm text-muted-foreground">No report</span>
        )}
      </TableCell>
      <TableCell>
        {report ? (
          <span className="text-sm">{Math.round(report.confidence * 100)}%</span>
        ) : (
          <span className="text-sm text-muted-foreground">--</span>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell max-w-xs">
        {generatingSymbol === symbol && generateProgress ? (
          <span className="text-sm text-blue-600 animate-pulse">{generateProgress}</span>
        ) : report ? (
          <span className="text-sm text-muted-foreground">{truncate(report.summary, 80)}</span>
        ) : (
          <span className="text-sm text-muted-foreground">--</span>
        )}
      </TableCell>
      <TableCell>
        <span className="text-sm text-muted-foreground">
          {report ? timeAgo(report.createdAt) : "Never"}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={onView} disabled={!report} title="View report">
            <Eye className="h-4 w-4 mr-1" />
            View
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-[120px]"
            onClick={onGenerate}
            disabled={generatingSymbol === symbol}
            title="Generate report"
          >
            <Zap className={`h-4 w-4 mr-1 ${generatingSymbol === symbol ? "animate-pulse" : ""}`} />
            {generatingSymbol === symbol ? "Generating..." : "Generate"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            disabled={generatingSymbol === symbol}
            title="Delete ticker"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// --- Collapsible Section ---

function CollapsibleSection({
  title,
  subtitle,
  icon,
  count,
  defaultOpen,
  onDelete,
  isDropTarget,
  onDrop,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  count: number;
  defaultOpen?: boolean;
  onDelete?: () => void;
  isDropTarget?: boolean;
  onDrop?: (symbol: string) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    if (!isDropTarget) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    if (!isDropTarget || !onDrop) return;
    e.preventDefault();
    setDragOver(false);
    const symbol = e.dataTransfer.getData("text/plain");
    if (symbol) onDrop(symbol);
  };

  return (
    <Card
      className={`transition-colors ${dragOver ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <span className="shrink-0">{icon}</span>
          <span className="font-medium text-sm truncate">{title}</span>
          {subtitle && <span className="text-xs text-muted-foreground truncate hidden sm:inline">{subtitle}</span>}
          <Badge variant="secondary" className="text-xs shrink-0">{count}</Badge>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isDropTarget && (
            <span className="text-xs text-muted-foreground mr-2 hidden sm:inline">Drop here to add</span>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Delete section"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {open && <CardContent className="p-0 pt-0">{children}</CardContent>}
    </Card>
  );
}

// --- Section Table ---

function SectionTable({
  symbols,
  reports,
  generatingSymbol,
  generateProgress,
  onView,
  onGenerate,
  onDelete,
  draggable,
}: {
  symbols: string[];
  reports: Record<string, ResearchReport>;
  generatingSymbol: string | null;
  generateProgress: string | null;
  onView: (symbol: string) => void;
  onGenerate: (symbol: string) => void;
  onDelete: (symbol: string) => void;
  draggable?: boolean;
}) {
  if (symbols.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        No tickers in this section.
      </div>
    );
  }

  // Sort: tickers with reports first (by recommendation), then without
  const sorted = [...symbols].sort((a, b) => {
    const ra = reports[a];
    const rb = reports[b];
    if (ra && !rb) return -1;
    if (!ra && rb) return 1;
    return a.localeCompare(b);
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {draggable && <TableHead className="w-8" />}
          <TableHead>Symbol</TableHead>
          <TableHead>Recommendation</TableHead>
          <TableHead>Confidence</TableHead>
          <TableHead className="hidden md:table-cell">Summary</TableHead>
          <TableHead>Last Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((symbol) => (
          <TickerRow
            key={symbol}
            symbol={symbol}
            report={reports[symbol]}
            generatingSymbol={generatingSymbol}
            generateProgress={generateProgress}
            onView={() => onView(symbol)}
            onGenerate={() => onGenerate(symbol)}
            onDelete={() => onDelete(symbol)}
            draggable={draggable}
          />
        ))}
      </TableBody>
    </Table>
  );
}

// --- Main Page ---

export function ResearchPage() {
  const navigate = useNavigate();
  const [tickers, setTickers] = useState<ResearchTicker[]>([]);
  const [reports, setReports] = useState<Record<string, ResearchReport>>({});
  const [macro, setMacro] = useState<MacroAnalysis | null>(null);
  const [watchlists, setWatchlists] = useState<WatchlistWithItems[]>([]);
  const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generate state
  const [generatingSymbol, setGeneratingSymbol] = useState<string | null>(null);
  const [generateProgress, setGenerateProgress] = useState<string | null>(null);

  // Discover dialog
  const [discoverOpen, setDiscoverOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [, , tickerData, wlList, scanRunData] = await Promise.allSettled([
        researchApi.syncWatchlist(),
        researchApi.refreshMacro().then(setMacro),
        researchApi.listTickers(),
        watchlistsApi.list(),
        researchApi.listScanRuns(),
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

      // Load watchlists with items
      if (wlList.status === "fulfilled") {
        const wlDetails = await Promise.allSettled(
          wlList.value.map((wl: Watchlist) => watchlistsApi.get(wl.id))
        );
        setWatchlists(
          wlDetails
            .filter((r): r is PromiseFulfilledResult<WatchlistWithItems> => r.status === "fulfilled")
            .map((r) => r.value)
        );
      }

      if (scanRunData.status === "fulfilled") {
        setScanRuns(scanRunData.value);
      }
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

  async function handleDelete(symbol: string) {
    setError(null);
    try {
      const result = await researchApi.deleteTicker(symbol);
      if (result.action === "deleted") {
        setTickers((prev) => prev.filter((t) => t.symbol !== symbol));
        setReports((prev) => {
          const next = { ...prev };
          delete next[symbol];
          return next;
        });
      } else {
        setReports((prev) => {
          const next = { ...prev };
          delete next[symbol];
          return next;
        });
        setTickers((prev) =>
          prev.map((t) =>
            t.symbol === symbol ? { ...t, lastAnalyzed: null } : t
          )
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Failed to delete ${symbol}`
      );
    }
  }

  async function handleGenerate(symbol: string) {
    setGeneratingSymbol(symbol);
    setGenerateProgress(null);
    setError(null);
    try {
      const researchSettings = await settingsApi
        .get<{ synthesizerMode: string; model?: string }>("research")
        .then((r) => r.value)
        .catch(() => ({ synthesizerMode: undefined, model: undefined }));

      const { jobId } = await researchApi.generate(symbol, {
        force: true,
        mode: researchSettings.synthesizerMode,
        model: researchSettings.model,
      });

      const maxAttempts = 150;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const job = await researchApi.getJob(jobId);

        if (job.progress) {
          setGenerateProgress(job.progress);
        }

        if (job.status === "completed") {
          const report = await researchApi.getReport(symbol);
          if (report) {
            setReports((prev) => ({ ...prev, [symbol]: report }));
          }
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

  async function handleDropOnWatchlist(watchlistId: string, symbol: string) {
    try {
      await watchlistsApi.addItem(watchlistId, { symbol });
      // Refresh watchlists to reflect the new item
      const updated = await watchlistsApi.get(watchlistId);
      setWatchlists((prev) =>
        prev.map((wl) => (wl.id === watchlistId ? updated : wl))
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add to watchlist";
      // Don't show error for duplicates (Prisma throws "Unique constraint failed")
      if (!msg.toLowerCase().includes("unique constraint") && !msg.includes("already")) {
        setError(msg);
      }
    }
  }

  async function handleDeleteScanRun(id: string) {
    try {
      await researchApi.deleteScanRun(id);
      setScanRuns((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete scan run");
    }
  }

  // Compute which symbols are in watchlists or scan runs
  const watchlistSymbolSets = new Map<string, Set<string>>();
  for (const wl of watchlists) {
    watchlistSymbolSets.set(wl.id, new Set(wl.items.map((i) => i.symbol)));
  }

  const scanRunSymbolSets = new Map<string, Set<string>>();
  for (const run of scanRuns) {
    scanRunSymbolSets.set(run.id, new Set(run.symbols));
  }

  // Tickers not in any watchlist or scan run
  const assignedSymbols = new Set<string>();
  for (const syms of watchlistSymbolSets.values()) {
    for (const s of syms) assignedSymbols.add(s);
  }
  for (const syms of scanRunSymbolSets.values()) {
    for (const s of syms) assignedSymbols.add(s);
  }

  const allTickerSymbols = new Set(tickers.map((t) => t.symbol));
  const unassignedSymbols = [...allTickerSymbols].filter((s) => !assignedSymbols.has(s));

  if (loading) return <PageLoadingSkeleton />;

  const formatScanSubtitle = (run: ScanRun) => {
    const parts: string[] = [];
    parts.push(run.locationCode);
    parts.push(timeAgo(run.createdAt));
    const tf = run.technicalFilter as Record<string, unknown> | undefined;
    if (tf?.enabled) {
      if (tf.maxRsi) parts.push(`RSI<${tf.maxRsi}`);
      if (tf.requireAboveSma200) parts.push("SMA200");
    }
    return parts.join(" · ");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Research"
        subtitle="AI-powered analysis and recommendations for tracked securities."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDiscoverOpen(true)}
          >
            <Radar className="h-4 w-4 mr-2" />
            Discover Tickers
          </Button>
        }
      />

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      <MacroBanner macro={macro} />

      <ScannerDialog
        open={discoverOpen}
        onOpenChange={setDiscoverOpen}
        onTickersAdded={() => fetchData()}
      />

      {/* Watchlist sections */}
      {watchlists.map((wl) => {
        const wlSymbols = wl.items.map((i) => i.symbol).filter((s) => allTickerSymbols.has(s));
        return (
          <CollapsibleSection
            key={wl.id}
            title={wl.name}
            icon={<List className="h-4 w-4 text-blue-500" />}
            count={wlSymbols.length}
            defaultOpen={true}
            isDropTarget={true}
            onDrop={(symbol) => handleDropOnWatchlist(wl.id, symbol)}
          >
            <SectionTable
              symbols={wlSymbols}
              reports={reports}
              generatingSymbol={generatingSymbol}
              generateProgress={generateProgress}
              onView={(s) => navigate(`/research/${s}`)}
              onGenerate={handleGenerate}
              onDelete={handleDelete}
              draggable={true}
            />
          </CollapsibleSection>
        );
      })}

      {/* Scan run sections */}
      {scanRuns.map((run) => {
        const runSymbols = run.symbols.filter((s) => allTickerSymbols.has(s));
        return (
          <CollapsibleSection
            key={run.id}
            title={run.name}
            subtitle={formatScanSubtitle(run)}
            icon={<Radar className="h-4 w-4 text-amber-500" />}
            count={runSymbols.length}
            defaultOpen={false}
            onDelete={() => handleDeleteScanRun(run.id)}
          >
            <SectionTable
              symbols={runSymbols}
              reports={reports}
              generatingSymbol={generatingSymbol}
              generateProgress={generateProgress}
              onView={(s) => navigate(`/research/${s}`)}
              onGenerate={handleGenerate}
              onDelete={handleDelete}
              draggable={true}
            />
          </CollapsibleSection>
        );
      })}

      {/* Unassigned tickers */}
      {unassignedSymbols.length > 0 && (
        <CollapsibleSection
          title="Other Tickers"
          icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
          count={unassignedSymbols.length}
          defaultOpen={true}
        >
          <SectionTable
            symbols={unassignedSymbols}
            reports={reports}
            generatingSymbol={generatingSymbol}
            generateProgress={generateProgress}
            onView={(s) => navigate(`/research/${s}`)}
            onGenerate={handleGenerate}
            onDelete={handleDelete}
            draggable={true}
          />
        </CollapsibleSection>
      )}

      {/* Empty state */}
      {watchlists.length === 0 && scanRuns.length === 0 && unassignedSymbols.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No tickers tracked yet</p>
            <p className="text-sm mt-1">
              Add symbols to a watchlist or use Discover Tickers to find candidates.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
