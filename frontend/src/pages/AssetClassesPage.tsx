import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { AssetClass } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { Pencil, Trash2, Plus } from "lucide-react";

const COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
];

export function AssetClassesPage() {
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<AssetClass | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "", color: "#6366f1" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAssetClasses();
  }, []);

  async function loadAssetClasses() {
    try {
      setLoading(true);
      const data = await api.assetClasses.list();
      setAssetClasses(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load asset classes");
    } finally {
      setLoading(false);
    }
  }

  function openCreateDialog() {
    setEditingClass(null);
    setFormData({ name: "", description: "", color: "#6366f1" });
    setDialogOpen(true);
  }

  function openEditDialog(assetClass: AssetClass) {
    setEditingClass(assetClass);
    setFormData({
      name: assetClass.name,
      description: assetClass.description || "",
      color: assetClass.color,
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setSaving(true);
    try {
      if (editingClass) {
        await api.assetClasses.update(editingClass.id, formData);
      } else {
        await api.assetClasses.create(formData);
      }
      setDialogOpen(false);
      await loadAssetClasses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save asset class");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(assetClass: AssetClass) {
    if (!confirm(`Delete "${assetClass.name}"? This will also remove all security assignments.`)) {
      return;
    }

    try {
      await api.assetClasses.delete(assetClass.id);
      await loadAssetClasses();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete asset class");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading asset classes...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Asset Classes</h1>
          <p className="text-muted-foreground">
            Define categories to organize your portfolio investments.
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add Asset Class
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Asset Classes</CardTitle>
        </CardHeader>
        <CardContent>
          {assetClasses.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No asset classes defined. Create one to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Color</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Securities</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assetClasses.map((ac) => (
                  <TableRow key={ac.id}>
                    <TableCell>
                      <div
                        className="h-6 w-6 rounded-full"
                        style={{ backgroundColor: ac.color }}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{ac.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {ac.description || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {ac._count?.securityAssignments || 0}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(ac)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(ac)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingClass ? "Edit Asset Class" : "Create Asset Class"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Stocks: Tech"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="e.g., Technology sector equities"
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`h-8 w-8 rounded-full transition-transform ${
                      formData.color === color ? "ring-2 ring-offset-2 ring-primary scale-110" : ""
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setFormData({ ...formData, color })}
                  />
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : editingClass ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
