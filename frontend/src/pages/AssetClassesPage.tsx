import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import type { AssetClass, AllocationProfile } from "@assup/shared";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Pencil, Trash2, Plus, AlertCircle, Check } from "lucide-react";
import { ASSET_CLASS_COLORS } from "@assup/shared";

interface AssetClassWithAllocation extends AssetClass {
  targetPercentage: number;
}

export function AssetClassesPage() {
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [profile, setProfile] = useState<AllocationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state for create/edit asset class
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClass, setEditingClass] = useState<AssetClassWithAllocation | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    color: "#6366f1",
    targetPercentage: 0,
  });
  const [saving, setSaving] = useState(false);

  // Allocation editing state - maps assetClassId to targetPercentage
  const [editedPercentages, setEditedPercentages] = useState<Map<string, number>>(new Map());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [savingAllocation, setSavingAllocation] = useState(false);

  // Combine asset classes with their allocation percentages
  const classesWithAllocation = useMemo((): AssetClassWithAllocation[] => {
    const profileTargets = new Map(
      profile?.targets.map((t) => [t.assetClassId, t.targetPercentage]) || []
    );

    return assetClasses.map((ac) => ({
      ...ac,
      targetPercentage: editedPercentages.has(ac.id)
        ? editedPercentages.get(ac.id)!
        : profileTargets.get(ac.id) ?? 0,
    }));
  }, [assetClasses, profile, editedPercentages]);

  // Calculate total percentage
  const totalPercentage = useMemo(
    () => classesWithAllocation.reduce((sum, ac) => sum + ac.targetPercentage, 0),
    [classesWithAllocation]
  );

  const isAllocationValid = Math.abs(totalPercentage - 100) < 0.01;

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [classesData, profileData] = await Promise.all([
        api.assetClasses.list(),
        api.allocationProfiles.getActive().catch(() => null),
      ]);
      setAssetClasses(classesData);
      setProfile(profileData);
      setEditedPercentages(new Map());
      setHasUnsavedChanges(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  function openCreateDialog() {
    setEditingClass(null);
    setFormData({ name: "", description: "", color: "#6366f1", targetPercentage: 0 });
    setDialogOpen(true);
  }

  function openEditDialog(assetClass: AssetClassWithAllocation) {
    setEditingClass(assetClass);
    setFormData({
      name: assetClass.name,
      description: assetClass.description || "",
      color: assetClass.color,
      targetPercentage: assetClass.targetPercentage,
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setSaving(true);
    try {
      if (editingClass) {
        // Update existing asset class
        await api.assetClasses.update(editingClass.id, {
          name: formData.name,
          description: formData.description,
          color: formData.color,
        });
        // Update the percentage in local state
        if (formData.targetPercentage !== editingClass.targetPercentage) {
          setEditedPercentages((prev) => {
            const next = new Map(prev);
            next.set(editingClass.id, formData.targetPercentage);
            return next;
          });
          setHasUnsavedChanges(true);
        }
      } else {
        // Create new asset class
        const newClass = await api.assetClasses.create({
          name: formData.name,
          description: formData.description,
          color: formData.color,
        });
        // Add to allocation with the specified percentage
        setEditedPercentages((prev) => {
          const next = new Map(prev);
          next.set(newClass.id, formData.targetPercentage);
          return next;
        });
        setHasUnsavedChanges(true);
      }
      setDialogOpen(false);
      await loadData();
      // Restore edited percentages after reload if we had changes
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
      // Remove from edited percentages
      setEditedPercentages((prev) => {
        const next = new Map(prev);
        next.delete(assetClass.id);
        return next;
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete asset class");
    }
  }

  function handlePercentageChange(assetClassId: string, value: string) {
    const numValue = parseFloat(value) || 0;
    const clampedValue = Math.max(0, Math.min(100, numValue));
    setEditedPercentages((prev) => {
      const next = new Map(prev);
      next.set(assetClassId, clampedValue);
      return next;
    });
    setHasUnsavedChanges(true);
  }

  function handleCancelChanges() {
    setEditedPercentages(new Map());
    setHasUnsavedChanges(false);
  }

  async function handleSaveAllocation() {
    if (!isAllocationValid) return;

    setSavingAllocation(true);
    try {
      const targets = classesWithAllocation.map((ac) => ({
        assetClassId: ac.id,
        targetPercentage: ac.targetPercentage,
      }));

      if (profile) {
        await api.allocationProfiles.update(profile.id, { targets });
      } else {
        await api.allocationProfiles.create({
          name: "Default Allocation",
          isActive: true,
          targets,
        });
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save allocation");
    } finally {
      setSavingAllocation(false);
    }
  }

  if (loading && assetClasses.length === 0) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Asset Classes & Allocation</h1>
          <p className="text-muted-foreground">
            Define asset classes and their target allocation percentages.
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add Asset Class
        </Button>
      </div>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Portfolio Allocation</CardTitle>
              <CardDescription>
                Set target percentages for each asset class. Total must equal 100%.
              </CardDescription>
            </div>
            {assetClasses.length > 0 && (
              <Badge
                variant={isAllocationValid ? "default" : "destructive"}
                className="text-sm"
              >
                {isAllocationValid ? (
                  <Check className="h-3 w-3 mr-1" />
                ) : (
                  <AlertCircle className="h-3 w-3 mr-1" />
                )}
                Total: {totalPercentage.toFixed(1)}%
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {classesWithAllocation.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">
                No asset classes defined yet. Create your first asset class to start building your allocation.
              </p>
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Create Asset Class
              </Button>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Color</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Description</TableHead>
                    <TableHead className="w-32 text-right">Target %</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {classesWithAllocation.map((ac) => (
                    <TableRow key={ac.id}>
                      <TableCell>
                        <div
                          className="h-6 w-6 rounded-full"
                          style={{ backgroundColor: ac.color }}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link
                          to={`/positions?assetClassId=${ac.id}`}
                          className="hover:text-primary hover:underline"
                        >
                          {ac.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden md:table-cell">
                        {ac.description || "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={ac.targetPercentage}
                            onChange={(e) => handlePercentageChange(ac.id, e.target.value)}
                            className="w-20 text-right"
                          />
                          <span className="text-muted-foreground text-sm">%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
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

              {/* Validation Message */}
              {!isAllocationValid && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  Allocation must total 100% (currently {totalPercentage.toFixed(1)}%)
                </div>
              )}

              {/* Save/Cancel Buttons */}
              {hasUnsavedChanges && (
                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button variant="outline" onClick={handleCancelChanges}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveAllocation}
                    disabled={!isAllocationValid || savingAllocation}
                  >
                    {savingAllocation ? "Saving..." : "Save Allocation"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingClass ? "Edit Asset Class" : "Add Asset Class"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {editingClass ? "Edit asset class details" : "Create a new asset class"}
            </DialogDescription>
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
              <Label htmlFor="targetPercentage">Target Allocation %</Label>
              <Input
                id="targetPercentage"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={formData.targetPercentage}
                onChange={(e) => setFormData({ ...formData, targetPercentage: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {ASSET_CLASS_COLORS.map((color) => (
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
