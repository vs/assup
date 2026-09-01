import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, FileText, Trash2, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { taxesApi } from "@/api/taxes";
import type {
  DividendReportUploadView,
  DividendReportUploadResult,
} from "@assup/shared";
import { DividendReportUploadDetail } from "./DividendReportUploadDetail";

export function DividendReportPanel({ onChanged }: { onChanged?: () => void }) {
  const [uploads, setUploads] = useState<DividendReportUploadView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<DividendReportUploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await taxesApi.dividendReport.listUploads();
      setUploads(data.uploads);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleUpload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const result = await taxesApi.dividendReport.upload(file);
      setLastResult(result);
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this Dividend Report upload? Tax reports will recompute on next load.")) return;
    setBusy(true);
    try {
      await taxesApi.dividendReport.deleteUpload(id);
      setLastResult(null);
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Dividend Report Overrides
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          Upload IBKR's per-year Dividend Report CSV to override FLEX classification with the
          post-reclassification view (e.g., TLT distributions reported as interest, partial splits).
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
          />
          <Button
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-2"
          >
            <Upload className="h-4 w-4" />
            Upload Dividend Report CSV
          </Button>
          {busy && <span className="text-sm text-muted-foreground">Working…</span>}
        </div>

        {error && (
          <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {lastResult && (
          <div className="rounded border bg-muted/40 p-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  lastResult.status === "duplicate"
                    ? "secondary"
                    : lastResult.status === "replaced"
                    ? "outline"
                    : "default"
                }
              >
                {lastResult.status}
              </Badge>
              <span>
                {lastResult.upload.recordCount} records · {lastResult.matchSummary.matchedFlexCount} matched FLEX rows
              </span>
            </div>
            {lastResult.matchSummary.recordsWithoutFlex.length > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                {lastResult.matchSummary.recordsWithoutFlex.length} record(s) had no FLEX counterpart.
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading uploads…</div>
        ) : uploads.length === 0 ? (
          <div className="text-sm text-muted-foreground">No Dividend Report uploaded yet.</div>
        ) : (
          <div className="divide-y rounded border">
            {uploads.map((u) => (
              <div key={u.id} className="flex items-center gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{u.taxYear}</span>
                    <span className="truncate text-sm text-muted-foreground">{u.filename}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(u.uploadedAt).toLocaleString()} · {u.recordCount} records
                    {u.accountNumber ? ` · ${u.accountNumber}` : ""}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setOpenId(u.id)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(u.id)} disabled={busy}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {openId && (
          <DividendReportUploadDetail uploadId={openId} onClose={() => setOpenId(null)} />
        )}
      </CardContent>
    </Card>
  );
}
