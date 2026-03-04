import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";
import type { ImportBatch } from "@assup/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { ImportDialog } from "@/components/profit/ImportDialog";

export function ImportsSection() {
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const loadImports = useCallback(async () => {
    try {
      setLoading(true);
      const result = await api.profit.imports.list();
      setImports(result.imports);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load imports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadImports();
  }, [loadImports]);

  const handleImportComplete = useCallback(() => {
    loadImports();
    setImportDialogOpen(false);
  }, [loadImports]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this import and all associated data?")) return;
    try {
      await api.profit.imports.delete(id);
      loadImports();
    } catch (err) {
      console.error("Failed to delete import:", err);
    }
  };

  if (loading && imports.length === 0) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6 py-2">
      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              Import History
              <Badge variant="secondary">{imports.length}</Badge>
            </CardTitle>
            <Button onClick={() => setImportDialogOpen(true)}>Import Data</Button>
          </div>
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

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImportComplete={handleImportComplete}
      />
    </div>
  );
}
