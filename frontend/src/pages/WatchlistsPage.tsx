import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api, researchApi, settingsApi } from "@/api";
import type {
  Watchlist,
  WatchlistWithItems,
  WatchlistItem,
  AssetClass,
  Recommendation,
  SparklinePoint,
} from "@assup/shared";
import {
  ErrorAlert,
  PageLoadingSkeleton,
  AssetClassSelect,
  ExternalLinks,
  RecommendationBadge,
} from "@/components/common";
import { TickerHoverCard } from "@/components/common/TickerHoverCard";
import { useTickerProfileContext } from "@/components/common/TickerProfileProvider";
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
import { useResearchJobs, useResearchJobFinished } from "@/hooks/useResearchJobs";
import { ScannerDialog } from "@/components/research/ScannerDialog";
import { Link } from "react-router-dom";
import {
  Plus,
  Pencil,
  X,
  Search,
  GripVertical,
  Radar,
  RefreshCw,
  FileText,
  ArrowUp,
  ArrowDown,
  SortAsc,
} from "lucide-react";

export function WatchlistsPage() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [selectedWatchlist, setSelectedWatchlist] =
    useState<WatchlistWithItems | null>(null);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "addSymbol">(
    "create"
  );
  const [formData, setFormData] = useState({ name: "", symbol: "" });
  const [saving, setSaving] = useState(false);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [actionWatchlist, setActionWatchlist] = useState<Watchlist | null>(null);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState("");

  // Scanner dialog
  const [discoverOpen, setDiscoverOpen] = useState(false);

  // Drag state for sidebar drop targets
  const [dragOverWatchlistId, setDragOverWatchlistId] = useState<string | null>(
    null
  );

  // Watchlist list sort
  type WatchlistSort = "newest" | "oldest" | "name";
  const [wlSort, setWlSort] = useState<WatchlistSort>("newest");
  const sortedWatchlists = useMemo(() => {
    const sorted = [...watchlists];
    switch (wlSort) {
      case "newest":
        return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      case "oldest":
        return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case "name":
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
  }, [watchlists, wlSort]);

  // Item sort state
  type SortField = "addedAt" | "symbol" | "recommendation" | "reportAge";
  type SortDir = "asc" | "desc";
  const [sortField, setSortField] = useState<SortField>("addedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "symbol" ? "asc" : "desc");
    }
  }

  const sortedItems = useMemo(() => {
    if (!selectedWatchlist) return [];
    const items = [...selectedWatchlist.items];
    const dir = sortDir === "asc" ? 1 : -1;

    items.sort((a, b) => {
      switch (sortField) {
        case "addedAt":
          return dir * (new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime());
        case "symbol":
          return dir * a.symbol.localeCompare(b.symbol);
        case "recommendation":
          return dir * (a.latestRecommendation || "").localeCompare(b.latestRecommendation || "");
        case "reportAge": {
          // Sort by lastAnalyzedAt timestamp; nulls go last
          const aTime = a.lastAnalyzedAt ? new Date(a.lastAnalyzedAt).getTime() : 0;
          const bTime = b.lastAnalyzedAt ? new Date(b.lastAnalyzedAt).getTime() : 0;
          if (!aTime && !bTime) return 0;
          if (!aTime) return 1;
          if (!bTime) return -1;
          return dir * (aTime - bTime);
        }
        default:
          return 0;
      }
    });
    return items;
  }, [selectedWatchlist, sortField, sortDir]);

  const { getJobForSymbol, startJob } = useResearchJobs();

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

  useEffect(() => {
    loadData();
  }, [loadData]);

  const { prefetch } = useTickerProfileContext();

  useEffect(() => {
    if (selectedWatchlist?.items?.length) {
      prefetch(selectedWatchlist.items.map((item) => item.symbol));
    }
  }, [selectedWatchlist, prefetch]);

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

  function startRename(wl: Watchlist) {
    setRenamingId(wl.id);
    setRenamingName(wl.name);
  }

  async function commitRename() {
    if (!renamingId) return;
    const trimmed = renamingName.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    // Skip API call if name didn't change
    const original = watchlists.find((w) => w.id === renamingId);
    if (original && original.name === trimmed) {
      setRenamingId(null);
      return;
    }
    try {
      await api.watchlists.update(renamingId, { name: trimmed });
      const wlData = await api.watchlists.list();
      setWatchlists(wlData);
      if (selectedWatchlist?.id === renamingId) {
        const full = await api.watchlists.get(renamingId);
        setSelectedWatchlist(full);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setRenamingId(null);
    }
  }

  function cancelRename() {
    setRenamingId(null);
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
    if (!actionWatchlist) return;

    try {
      await api.watchlists.delete(actionWatchlist.id);
      if (selectedWatchlist?.id === actionWatchlist.id) {
        setSelectedWatchlist(null);
      }
      setDeleteDialogOpen(false);
      setActionWatchlist(null);
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
    const existingJob = getJobForSymbol(symbol);
    if (existingJob && (existingJob.status === "queued" || existingJob.status === "running")) return;
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
      startJob(symbol, jobId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to generate report for ${symbol}`
      );
    }
  }

  async function handleAnalyzeAll() {
    if (!selectedWatchlist) return;
    for (const item of selectedWatchlist.items) {
      const job = getJobForSymbol(item.symbol);
      if (!job || (job.status !== "queued" && job.status !== "running")) {
        handleGenerateReport(item.symbol);
      }
    }
  }

  useResearchJobFinished(async (finishedSymbol, status, error) => {
    if (status === "failed") {
      setError(error || `Report generation failed for ${finishedSymbol}`);
      return;
    }
    // Refresh watchlist to get updated enrichment data
    if (selectedWatchlistRef.current) {
      try {
        const full = await api.watchlists.get(selectedWatchlistRef.current.id);
        setSelectedWatchlist(full);
      } catch {
        // Ignore refresh errors
      }
    }
  });

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
  async function handleScanComplete(newWatchlistId?: string) {
    const wlData = await api.watchlists.list();
    setWatchlists(wlData);

    // Select the newly created watchlist, or fall back to current selection
    const targetId = newWatchlistId ?? selectedWatchlistRef.current?.id;
    if (targetId) {
      try {
        const full = await api.watchlists.get(targetId);
        setSelectedWatchlist(full);
      } catch {
        // Watchlist may not exist; select first available
        if (wlData.length > 0) {
          const full = await api.watchlists.get(wlData[0].id);
          setSelectedWatchlist(full);
        }
      }
    } else if (wlData.length > 0) {
      const full = await api.watchlists.get(wlData[0].id);
      setSelectedWatchlist(full);
    }
  }

  if (loading && watchlists.length === 0) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-4">
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
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="text-sm">Your Watchlists</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={`Sort: ${wlSort === "newest" ? "Newest first" : wlSort === "oldest" ? "Oldest first" : "By name"}`}
              onClick={() =>
                setWlSort((s) =>
                  s === "newest" ? "name" : s === "name" ? "oldest" : "newest"
                )
              }
            >
              {wlSort === "name" ? (
                <SortAsc className="h-3.5 w-3.5" />
              ) : wlSort === "newest" ? (
                <ArrowDown className="h-3.5 w-3.5" />
              ) : (
                <ArrowUp className="h-3.5 w-3.5" />
              )}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {sortedWatchlists.length === 0 ? (
              <p className="text-muted-foreground text-center py-4 text-sm">
                No watchlists yet
              </p>
            ) : (
              <div className="divide-y">
                {sortedWatchlists.map((wl) => (
                  <button
                    key={wl.id}
                    onClick={() => selectWatchlist(wl.id)}
                    onDragOver={(e) => handleSidebarDragOver(e, wl.id)}
                    onDragLeave={handleSidebarDragLeave}
                    onDrop={(e) => handleSidebarDrop(e, wl.id)}
                    className={`group w-full px-4 py-3 text-left hover:bg-muted transition-colors ${
                      selectedWatchlist?.id === wl.id ? "bg-muted" : ""
                    } ${
                      dragOverWatchlistId === wl.id
                        ? "ring-2 ring-primary/50 bg-primary/5"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        {renamingId === wl.id ? (
                          <input
                            autoFocus
                            value={renamingName}
                            onChange={(e) => setRenamingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitRename();
                              } else if (e.key === "Escape") {
                                cancelRename();
                              }
                            }}
                            onBlur={() => commitRename()}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full bg-transparent border-b border-primary outline-none font-medium text-sm py-0"
                          />
                        ) : (
                          <div
                            className="font-medium truncate"
                            onClick={(e) => {
                              if (selectedWatchlist?.id === wl.id) {
                                e.stopPropagation();
                                startRename(wl);
                              }
                            }}
                          >
                            {wl.name}
                          </div>
                        )}
                        <div className="text-sm text-muted-foreground">
                          {wl._count?.items || 0} symbols
                        </div>
                      </div>
                      {renamingId !== wl.id && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span
                            role="button"
                            className="p-1 rounded hover:bg-muted-foreground/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              startRename(wl);
                            }}
                            title="Rename watchlist"
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                          <span
                            role="button"
                            className="p-1 rounded hover:bg-muted-foreground/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionWatchlist(wl);
                              setDeleteDialogOpen(true);
                            }}
                            title="Delete watchlist"
                          >
                            <X className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                        </div>
                      )}
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
                  {(() => {
                    const generatingCount = selectedWatchlist?.items.filter(
                      (item) => {
                        const job = getJobForSymbol(item.symbol);
                        return job && (job.status === "queued" || job.status === "running");
                      }
                    ).length ?? 0;
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAnalyzeAll}
                        disabled={generatingCount > 0}
                      >
                        <RefreshCw className="h-4 w-4 mr-1" />
                        {generatingCount > 0
                          ? `Updating ${generatingCount}...`
                          : "Update All"}
                      </Button>
                    );
                  })()}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openAddSymbolDialog}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Symbol
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
                          <SortableHead field="symbol" current={sortField} dir={sortDir} onToggle={toggleSort}>Symbol</SortableHead>
                          <TableHead className="w-24">1Y</TableHead>
                          <TableHead>Asset Class</TableHead>
                          <SortableHead field="recommendation" current={sortField} dir={sortDir} onToggle={toggleSort}>Recommendation</SortableHead>
                          <SortableHead field="reportAge" current={sortField} dir={sortDir} onToggle={toggleSort}>Report</SortableHead>
                          <SortableHead field="addedAt" current={sortField} dir={sortDir} onToggle={toggleSort} className="w-36">Added</SortableHead>
                          <TableHead className="w-36">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedItems.map((item) => (
                          <TickerRow
                            key={item.id}
                            item={item}
                            assetClasses={assetClasses}
                            getSparklineState={getSparklineState}
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
              {dialogMode === "create" ? "Create Watchlist" : "Add Symbol"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {dialogMode === "create"
                ? "Create a new watchlist"
                : "Add a symbol to the watchlist"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {dialogMode === "create" ? (
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
              Are you sure you want to delete &quot;{actionWatchlist?.name}
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
    data: SparklinePoint[];
    loading: boolean;
    error: boolean;
  };
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
  onDragStart,
  onChartClick,
  onAssignAssetClass,
  onGenerateReport,
  onRemove,
}: TickerRowProps) {
  const { getJobForSymbol } = useResearchJobs();
  const activeJob = getJobForSymbol(item.symbol);
  const isGenerating = activeJob ? activeJob.status === "queued" || activeJob.status === "running" : false;
  const generateProgress = activeJob?.progress ?? null;
  const sparkline = getSparklineState(item.symbol);

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
        <span className="inline-flex items-center gap-1">
          <TickerHoverCard symbol={item.symbol}>
            <Link
              to={`/tickers/${item.symbol}`}
              className="font-medium hover:text-primary hover:underline"
            >
              {item.symbol}
            </Link>
          </TickerHoverCard>
          <ExternalLinks symbol={item.symbol} />
        </span>
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
          <span className="inline-flex items-center rounded-full border border-dashed border-muted-foreground/30 px-2 py-0.5 text-xs text-muted-foreground">
            Not analyzed
          </span>
        )}
      </TableCell>

      {/* Report age */}
      <TableCell>
        {item.reportAge ? (
          <Link
            to={`/tickers/${item.symbol}`}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <FileText className="h-3.5 w-3.5" />
            {item.reportAge}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">No report</span>
        )}
      </TableCell>

      {/* Added at */}
      <TableCell>
        <span className="text-sm text-muted-foreground">
          {new Date(item.addedAt).toLocaleDateString()}
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
            title="Update ticker"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1 ${isGenerating ? "animate-spin" : ""}`}
            />
            {isGenerating
              ? generateProgress
                ? generateProgress.length > 12
                  ? generateProgress.slice(0, 12) + "..."
                  : generateProgress
                : "Working..."
              : "Update"}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="Scan options">
            <Link to={`/scanner?symbol=${item.symbol}`}>
              <Search className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 ml-4"
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

// --- Sortable Table Head ---

function SortableHead({
  field,
  current,
  dir,
  onToggle,
  className,
  children,
}: {
  field: string;
  current: string;
  dir: "asc" | "desc";
  onToggle: (field: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const active = current === field;
  return (
    <TableHead className={className}>
      <button
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => onToggle(field)}
      >
        {children}
        {active &&
          (dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          ))}
      </button>
    </TableHead>
  );
}
