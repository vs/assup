import { useState, useEffect, useMemo } from "react";
import { api } from "@/api";
import type { Watchlist, WatchlistWithItems, WatchlistItem, AssetClass } from "@assup/shared";
import { ErrorAlert, PageLoadingSkeleton, AssetClassSelect, ExternalLinks } from "@/components/common";
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
import { Badge } from "@/components/ui/badge";
import { ChartModal } from "@/components/ChartModal";
import { Sparkline } from "@/components/Sparkline";
import { useSparklines } from "@/hooks/useSparklines";
import { Link } from "react-router-dom";
import { Plus, Trash2, Pencil, X, Search } from "lucide-react";

export function WatchlistsPage() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [selectedWatchlist, setSelectedWatchlist] = useState<WatchlistWithItems | null>(null);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | "addSymbol">("create");
  const [formData, setFormData] = useState({ name: "", symbol: "" });
  const [saving, setSaving] = useState(false);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

  // Sparklines
  const symbols = useMemo(
    () => selectedWatchlist?.items.map((item) => item.symbol) || [],
    [selectedWatchlist]
  );
  const { getSparklineState } = useSparklines(symbols);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [wlData, acData] = await Promise.all([
        api.watchlists.list(),
        api.assetClasses.list(),
      ]);
      setWatchlists(wlData);
      setAssetClasses(acData);

      // Select first watchlist by default
      if (wlData.length > 0 && !selectedWatchlist) {
        const full = await api.watchlists.get(wlData[0].id);
        setSelectedWatchlist(full);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function selectWatchlist(id: string) {
    try {
      const full = await api.watchlists.get(id);
      setSelectedWatchlist(full);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load watchlist");
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
        const newWl = await api.watchlists.create({ name: formData.name.trim() });
        setWatchlists([...watchlists, newWl]);
        const full = await api.watchlists.get(newWl.id);
        setSelectedWatchlist(full);
      } else if (dialogMode === "edit" && selectedWatchlist) {
        await api.watchlists.update(selectedWatchlist.id, { name: formData.name.trim() });
        await loadData();
        const full = await api.watchlists.get(selectedWatchlist.id);
        setSelectedWatchlist(full);
      } else if (dialogMode === "addSymbol" && selectedWatchlist) {
        await api.watchlists.addItem(selectedWatchlist.id, {
          symbol: formData.symbol.trim().toUpperCase(),
        });
        const full = await api.watchlists.get(selectedWatchlist.id);
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
    if (!confirm(`Delete "${selectedWatchlist.name}"?`)) return;

    try {
      await api.watchlists.delete(selectedWatchlist.id);
      setSelectedWatchlist(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleRemoveItem(item: WatchlistItem) {
    if (!selectedWatchlist) return;

    try {
      await api.watchlists.removeItem(selectedWatchlist.id, item.id);
      const full = await api.watchlists.get(selectedWatchlist.id);
      setSelectedWatchlist(full);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove item");
    }
  }

  async function handleAssignAssetClass(item: WatchlistItem, assetClassId: string) {
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

  if (loading && watchlists.length === 0) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Watchlists</h1>
          <p className="text-muted-foreground">
            Monitor securities and assign them to asset classes.
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          New Watchlist
        </Button>
      </div>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Watchlist Tabs */}
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
                    className={`w-full px-4 py-3 text-left hover:bg-muted transition-colors ${
                      selectedWatchlist?.id === wl.id ? "bg-muted" : ""
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

        {/* Selected Watchlist */}
        <Card className="lg:col-span-3">
          {selectedWatchlist ? (
            <>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{selectedWatchlist.name}</CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={openAddSymbolDialog}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Symbol
                  </Button>
                  <Button variant="ghost" size="icon" onClick={openEditDialog}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={handleDeleteWatchlist}>
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
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead className="w-24">7D</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Asset Class</TableHead>
                        <TableHead className="w-12">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedWatchlist.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="flex items-center">
                              <a
                                href={`https://www.tradingview.com/chart/?symbol=${item.symbol}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium hover:text-primary hover:underline"
                              >
                                {item.symbol}
                              </a>
                              <ExternalLinks symbol={item.symbol} />
                            </div>
                          </TableCell>
                          <TableCell className="w-24">
                            {(() => {
                              const sparkline = getSparklineState(item.symbol);
                              return (
                                <Sparkline
                                  data={sparkline.data}
                                  loading={sparkline.loading}
                                  error={sparkline.error}
                                  onChartClick={() => setChartSymbol(item.symbol)}
                                />
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {item.secType === "STK" ? "Stock" : item.secType}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <AssetClassSelect
                              value={item.assetClassId}
                              onValueChange={(v) => handleAssignAssetClass(item, v)}
                              placeholder="Assign..."
                              assetClasses={assetClasses}
                              className="w-44"
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                asChild
                                title="Scan options"
                              >
                                <Link to={`/scanner?symbol=${item.symbol}`}>
                                  <Search className="h-4 w-4" />
                                </Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveItem(item)}
                                title="Remove from watchlist"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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

      {/* Dialog */}
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
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
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
                  onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                  placeholder="e.g., AAPL"
                  required
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : dialogMode === "addSymbol" ? "Add" : "Save"}
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
    </div>
  );
}
