import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api, researchApi, settingsApi } from "@/api";
import type {
  Watchlist,
  WatchlistWithItems,
  WatchlistItem,
  AssetClass,
  MacroAnalysis,
  Recommendation,
} from "@assup/shared";
import {
  ErrorAlert,
  PageLoadingSkeleton,
  AssetClassSelect,
  ExternalLinks,
  RecommendationBadge,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartModal } from "@/components/ChartModal";
import { Sparkline } from "@/components/Sparkline";
import { useSparklines } from "@/hooks/useSparklines";
import { MacroBanner } from "@/components/research/MacroBanner";
import { SignalBadge } from "@/components/research/SignalBadge";
import { ScannerDialog } from "@/components/research/ScannerDialog";
import { Link } from "react-router-dom";
import {
  Plus,
  Trash2,
  Pencil,
  X,
  Search,
  GripVertical,
  Radar,
  Zap,
  BarChart3,
} from "lucide-react";

export function WatchlistsPage() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [selectedWatchlist, setSelectedWatchlist] =
    useState<WatchlistWithItems | null>(null);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Macro state
  const [macro, setMacro] = useState<MacroAnalysis | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<
    "create" | "edit" | "addSymbol"
  >("create");
  const [formData, setFormData] = useState({ name: "", symbol: "" });
  const [saving, setSaving] = useState(false);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Scanner dialog
  const [discoverOpen, setDiscoverOpen] = useState(false);

  // Report generation state
  const [generatingSymbol, setGeneratingSymbol] = useState<string | null>(null);
  const [generateProgress, setGenerateProgress] = useState<string | null>(null);

  // Drag state for sidebar drop targets
  const [dragOverWatchlistId, setDragOverWatchlistId] = useState<string | null>(
    null
  );

  // Sparklines
  const symbols = useMemo(
    () => selectedWatchlist?.items.map((item) => item.symbol) || [],
    [selectedWatchlist]
  );
  const { getSparklineState } = useSparklines(symbols);

  const selectedWatchlistRef = useRef(selectedWatchlist);
  useEffect(() => {
    selectedWatchlistRef.current = selectedWatchlist;
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [wlData, acData] = await Promise.all([
        api.watchlists.list(),
        api.assetClasses.list(),
      ]);
      setWatchlists(wlData);
      setAssetClasses(acData);

      // Select first watchlist by default
      if (wlData.length > 0 && !selectedWatchlistRef.current) {
        const full = await api.watchlists.get(wlData[0].id);
        setSelectedWatchlist(full);
      } else if (selectedWatchlistRef.current) {
        // Refresh the currently selected watchlist
        try {
          const full = await api.watchlists.get(
            selectedWatchlistRef.current.id
          );
          setSelectedWatchlist(full);
        } catch {
          // Watchlist may have been deleted
          if (wlData.length > 0) {
            const full = await api.watchlists.get(wlData[0].id);
            setSelectedWatchlist(full);
          } else {
            setSelectedWatchlist(null);
          }
        }
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load macro on mount
  useEffect(() => {
    researchApi
      .refreshMacro()
      .then(setMacro)
      .catch(() => {
        // Macro is best-effort; don't block the page
      });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function selectWatchlist(id: string) {
    try {
      const full = await api.watchlists.get(id);
      setSelectedWatchlist(full);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load watchlist"
      );
    }
  }

  function openCreateDialog() {
    setDialogMode("create");
    setFormData({ name: "", symbol: "" });
    setDialogOpen(true);
  }

  function openEditDialog() {
    if (!selectedWatchlist) return;
    setDialogMode("edit");
    setFormData({ name: selectedWatchlist.name, symbol: "" });
    setDialogOpen(true);
  }

  function openAddSymbolDialog() {
    setDialogMode("addSymbol");
    setFormData({ name: "", symbol: "" });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      if (dialogMode === "create") {
        const newWl = await api.watchlists.create({
          name: formData.name.trim(),
        });
        setWatchlists((prev) => [...prev, newWl]);
        const full = await api.watchlists.get(newWl.id);
        setSelectedWatchlist(full);
      } else if (dialogMode === "edit" && selectedWatchlist) {
        await api.watchlists.update(selectedWatchlist.id, {
          name: formData.name.trim(),
        });
        const [wlData, full] = await Promise.all([
          api.watchlists.list(),
          api.watchlists.get(selectedWatchlist.id),
        ]);
        setWatchlists(wlData);
        setSelectedWatchlist(full);
      } else if (dialogMode === "addSymbol" && selectedWatchlist) {
        await api.watchlists.addItem(selectedWatchlist.id, {
          symbol: formData.symbol.trim().toUpperCase(),
        });
        const [wlData, full] = await Promise.all([
          api.watchlists.list(),
          api.watchlists.get(selectedWatchlist.id),
        ]);
        setWatchlists(wlData);
        setSelectedWatchlist(full);
      }
      setDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteWatchlist() {
    if (!selectedWatchlist) return;

    try {
      await api.watchlists.delete(selectedWatchlist.id);
      setSelectedWatchlist(null);
      setDeleteDialogOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleRemoveItem(item: WatchlistItem) {
    if (!selectedWatchlist) return;

    try {
      await api.watchlists.removeItem(selectedWatchlist.id, item.id);
      const [wlData, full] = await Promise.all([
        api.watchlists.list(),
        api.watchlists.get(selectedWatchlist.id),
      ]);
      setWatchlists(wlData);
      setSelectedWatchlist(full);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove item");
    }
  }

  async function handleAssignAssetClass(
    item: WatchlistItem,
    assetClassId: string
  ) {
    try {
      await api.securityAssignments.create({
        symbol: item.symbol,
        secType: item.secType,
        assetClassId,
        source: "watchlist",
      });
      // Refresh to show updated assignment
      const full = await api.watchlists.get(selectedWatchlist!.id);
      setSelectedWatchlist(full);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign");
    }
  }

  // --- Report generation ---
  async function handleGenerateReport(symbol: string) {
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
          // Refresh watchlist to get updated enrichment data
          if (selectedWatchlistRef.current) {
            const full = await api.watchlists.get(
              selectedWatchlistRef.current.id
            );
            setSelectedWatchlist(full);
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

  // --- Drag and drop ---
  function handleDragStart(e: React.DragEvent, item: WatchlistItem) {
    e.dataTransfer.setData("application/watchlist-item-id", item.id);
    e.dataTransfer.setData(
      "application/watchlist-source-id",
      item.watchlistId
    );
    e.dataTransfer.effectAllowed = "move";
  }

  function handleSidebarDragOver(e: React.DragEvent, watchlistId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverWatchlistId(watchlistId);
  }

  function handleSidebarDragLeave() {
    setDragOverWatchlistId(null);
  }

  async function handleSidebarDrop(
    e: React.DragEvent,
    targetWatchlistId: string
  ) {
    e.preventDefault();
    setDragOverWatchlistId(null);

    const itemId = e.dataTransfer.getData("application/watchlist-item-id");
    const sourceWatchlistId = e.dataTransfer.getData(
      "application/watchlist-source-id"
    );

    if (!itemId || !sourceWatchlistId) return;
    if (sourceWatchlistId === targetWatchlistId) return;

    try {
      await api.watchlists.moveItem(sourceWatchlistId, itemId, targetWatchlistId);

      // Refresh watchlist list for updated counts
      const wlData = await api.watchlists.list();
      setWatchlists(wlData);

      // Refresh the currently selected watchlist
      if (selectedWatchlistRef.current) {
        const full = await api.watchlists.get(
          selectedWatchlistRef.current.id
        );
        setSelectedWatchlist(full);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to move item";
      if (
        !msg.toLowerCase().includes("unique constraint") &&
        !msg.includes("already")
      ) {
        setError(msg);
      }
    }
  }

  // --- Scanner complete callback ---
  async function handleScanComplete() {
    // Refresh watchlist list (scanner may have added tickers to watchlists)
    const wlData = await api.watchlists.list();
    setWatchlists(wlData);

    // If there's a new watchlist, auto-select it
    if (wlData.length > 0) {
      const lastWl = wlData[wlData.length - 1];
      const full = await api.watchlists.get(lastWl.id);
      setSelectedWatchlist(full);
    }
  }

  if (loading && watchlists.length === 0) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-4">
      {/* Macro Banner */}
      <MacroBanner macro={macro} />

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Watchlists</h1>
          <p className="text-muted-foreground text-sm">
            Monitor securities, research signals, and manage asset class
            assignments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setDiscoverOpen(true)}>
            <Radar className="h-4 w-4 mr-2" />
            Discover
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            New Watchlist
          </Button>
        </div>
      </div>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left sidebar -- watchlist list (drop targets) */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm">Your Watchlists</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {watchlists.length === 0 ? (
              <p className="text-muted-foreground text-center py-4 text-sm">
                No watchlists yet
              </p>
            ) : (
              <div className="divide-y">
                {watchlists.map((wl) => (
                  <button
                    key={wl.id}
                    onClick={() => selectWatchlist(wl.id)}
                    onDragOver={(e) => handleSidebarDragOver(e, wl.id)}
                    onDragLeave={handleSidebarDragLeave}
                    onDrop={(e) => handleSidebarDrop(e, wl.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-muted transition-colors ${
                      selectedWatchlist?.id === wl.id ? "bg-muted" : ""
                    } ${
                      dragOverWatchlistId === wl.id
                        ? "ring-2 ring-primary/50 bg-primary/5"
                        : ""
                    }`}
                  >
                    <div className="font-medium">{wl.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {wl._count?.items || 0} symbols
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right main area -- selected watchlist items */}
        <Card className="lg:col-span-3">
          {selectedWatchlist ? (
            <>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{selectedWatchlist.name}</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openAddSymbolDialog}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Symbol
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={openEditDialog}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {selectedWatchlist.items.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No symbols in this watchlist. Add some to get started.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8" />
                          <TableHead>Symbol</TableHead>
                          <TableHead className="w-10" />
                          <TableHead className="w-24">7D</TableHead>
                          <TableHead>Signal</TableHead>
                          <TableHead>Asset Class</TableHead>
                          <TableHead>Recommendation</TableHead>
                          <TableHead>Report</TableHead>
                          <TableHead className="w-36">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedWatchlist.items.map((item) => (
                          <TickerRow
                            key={item.id}
                            item={item}
                            assetClasses={assetClasses}
                            getSparklineState={getSparklineState}
                            generatingSymbol={generatingSymbol}
                            generateProgress={generateProgress}
                            onDragStart={handleDragStart}
                            onChartClick={setChartSymbol}
                            onAssignAssetClass={handleAssignAssetClass}
                            onGenerateReport={handleGenerateReport}
                            onRemove={handleRemoveItem}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </>
          ) : (
            <CardContent className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">
                Select a watchlist or create a new one
              </p>
            </CardContent>
          )}
        </Card>
      </div>

      {/* Scanner Dialog */}
      <ScannerDialog
        open={discoverOpen}
        onOpenChange={setDiscoverOpen}
        onTickersAdded={handleScanComplete}
      />

      {/* Create/Edit/AddSymbol Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "create"
                ? "Create Watchlist"
                : dialogMode === "edit"
                  ? "Edit Watchlist"
                  : "Add Symbol"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {dialogMode === "create"
                ? "Create a new watchlist"
                : dialogMode === "edit"
                  ? "Edit watchlist details"
                  : "Add a symbol to the watchlist"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {dialogMode !== "addSymbol" ? (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="e.g., Tech Stocks"
                  required
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="symbol">Symbol</Label>
                <Input
                  id="symbol"
                  value={formData.symbol}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      symbol: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="e.g., AAPL"
                  required
                />
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : dialogMode === "addSymbol"
                    ? "Add"
                    : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ChartModal
        symbol={chartSymbol}
        open={!!chartSymbol}
        onClose={() => setChartSymbol(null)}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Watchlist</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{selectedWatchlist?.name}
              &quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteWatchlist}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- Ticker Row Component ---

interface TickerRowProps {
  item: WatchlistItem;
  assetClasses: AssetClass[];
  getSparklineState: (symbol: string) => {
    data: Array<{ close: number }>;
    loading: boolean;
    error: boolean;
  };
  generatingSymbol: string | null;
  generateProgress: string | null;
  onDragStart: (e: React.DragEvent, item: WatchlistItem) => void;
  onChartClick: (symbol: string) => void;
  onAssignAssetClass: (item: WatchlistItem, assetClassId: string) => void;
  onGenerateReport: (symbol: string) => void;
  onRemove: (item: WatchlistItem) => void;
}

function TickerRow({
  item,
  assetClasses,
  getSparklineState,
  generatingSymbol,
  generateProgress,
  onDragStart,
  onChartClick,
  onAssignAssetClass,
  onGenerateReport,
  onRemove,
}: TickerRowProps) {
  const sparkline = getSparklineState(item.symbol);
  const isGenerating = generatingSymbol === item.symbol;

  return (
    <TableRow
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      className="cursor-grab active:cursor-grabbing"
    >
      {/* Drag handle */}
      <TableCell className="w-8 px-2">
        <GripVertical className="h-4 w-4 text-muted-foreground/40" />
      </TableCell>

      {/* Symbol */}
      <TableCell>
        <Link
          to={`/watchlists/${item.symbol}`}
          className="font-medium hover:text-primary hover:underline"
        >
          {item.symbol}
        </Link>
      </TableCell>

      {/* External links */}
      <TableCell className="w-10">
        <ExternalLinks symbol={item.symbol} />
      </TableCell>

      {/* Sparkline */}
      <TableCell className="w-24">
        <Sparkline
          data={sparkline.data}
          loading={sparkline.loading}
          error={sparkline.error}
          onChartClick={() => onChartClick(item.symbol)}
        />
      </TableCell>

      {/* Signal badge */}
      <TableCell>
        <SignalBadge
          signal={item.latestSignal}
          confidence={item.latestConfidence}
        />
      </TableCell>

      {/* Asset class */}
      <TableCell>
        <AssetClassSelect
          value={item.assetClassId}
          onValueChange={(v) => onAssignAssetClass(item, v)}
          placeholder="Assign..."
          assetClasses={assetClasses}
          className="w-44"
        />
      </TableCell>

      {/* Recommendation badge */}
      <TableCell>
        {item.latestRecommendation ? (
          <RecommendationBadge
            recommendation={item.latestRecommendation as Recommendation}
          />
        ) : (
          <span className="text-sm text-muted-foreground">--</span>
        )}
      </TableCell>

      {/* Report age */}
      <TableCell>
        <span className="text-sm text-muted-foreground">
          {item.reportAge || "No report"}
        </span>
      </TableCell>

      {/* Actions */}
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-[100px]"
            onClick={() => onGenerateReport(item.symbol)}
            disabled={isGenerating}
            title="Generate research report"
          >
            <Zap
              className={`h-3.5 w-3.5 mr-1 ${isGenerating ? "animate-pulse" : ""}`}
            />
            {isGenerating
              ? generateProgress
                ? generateProgress.length > 12
                  ? generateProgress.slice(0, 12) + "..."
                  : generateProgress
                : "Working..."
              : "Report"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onChartClick(item.symbol)}
            title="Open chart"
          >
            <BarChart3 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="Scan options">
            <Link to={`/scanner?symbol=${item.symbol}`}>
              <Search className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onRemove(item)}
            title="Remove from watchlist"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
