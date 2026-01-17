import { useState, useCallback } from "react";
import { api } from "@/api";
import type { ImportResult } from "@assup/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

export function ImportDialog({
  open,
  onOpenChange,
  onImportComplete,
}: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        setFile(selectedFile);
        setError(null);
        setResult(null);
      }
    },
    []
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      const ext = droppedFile.name.toLowerCase();
      if (ext.endsWith(".xml") || ext.endsWith(".csv")) {
        setFile(droppedFile);
        setError(null);
        setResult(null);
      } else {
        setError("Please select an XML or CSV file");
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleImport = async () => {
    if (!file) return;

    try {
      setImporting(true);
      setError(null);

      const importResult = await api.profit.import(file);
      setResult(importResult);

      // Auto-close after successful import with new data
      if (
        importResult.stats.tradesImported > 0 ||
        importResult.stats.dividendsImported > 0 ||
        importResult.stats.interestImported > 0
      ) {
        setTimeout(() => {
          onImportComplete();
          resetState();
        }, 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const resetState = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  const handleClose = () => {
    if (!importing) {
      resetState();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Flex Query</DialogTitle>
          <DialogDescription>
            Upload your IBKR Flex Query export (XML or CSV format)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop Zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            {file ? (
              <div className="space-y-2">
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
                <Button variant="outline" size="sm" onClick={resetState}>
                  Choose Different File
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  Drag and drop your file here, or
                </p>
                <label>
                  <input
                    type="file"
                    accept=".xml,.csv"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button variant="outline" size="sm" asChild>
                    <span>Browse Files</span>
                  </Button>
                </label>
              </div>
            )}
          </div>

          {/* Progress */}
          {importing && (
            <div className="space-y-2">
              <Progress value={undefined} className="h-2" />
              <p className="text-sm text-center text-muted-foreground">
                Importing...
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="p-3 rounded-md bg-primary/10 text-sm space-y-1">
              <p className="font-medium">Import Complete</p>
              <p>
                Period: {result.periodStart} to {result.periodEnd}
              </p>
              <ul className="text-muted-foreground">
                <li>Trades imported: {result.stats.tradesImported}</li>
                {result.stats.tradesSkipped > 0 && (
                  <li>Trades skipped (duplicates): {result.stats.tradesSkipped}</li>
                )}
                <li>Dividends imported: {result.stats.dividendsImported}</li>
                <li>Interest imported: {result.stats.interestImported}</li>
                {result.stats.assignmentsDetected > 0 && (
                  <li>Assignments detected: {result.stats.assignmentsDetected}</li>
                )}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClose} disabled={importing}>
              {result ? "Close" : "Cancel"}
            </Button>
            {!result && (
              <Button onClick={handleImport} disabled={!file || importing}>
                {importing ? "Importing..." : "Import"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
