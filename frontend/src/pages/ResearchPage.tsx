import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { researchApi, watchlistsApi, settingsApi } from "@/api";
import type {
  ResearchTicker,
  ResearchReport,
  MacroAnalysis,
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
  ChevronDown,
  ChevronRight,
  Radar,
  Trash2,
  GripVertical,
  List,
} from "lucide-react";
import { timeAgo } from "@/utils/format";
import { ScannerDialog } from "@/components/research/ScannerDialog";
import { MacroBanner } from "@/components/research/MacroBanner";

// --- Helpers ---

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "...";
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
