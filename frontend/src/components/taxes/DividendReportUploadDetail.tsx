import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { taxesApi } from "@/api/taxes";
import type { DividendReportUploadDetail as Detail } from "@assup/shared";

export function DividendReportUploadDetail({
  uploadId,
  onClose,
}: {
  uploadId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    taxesApi.dividendReport
      .getUpload(uploadId)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [uploadId]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            Dividend Report — {data?.upload.taxYear ?? "…"} ({data?.upload.filename ?? ""})
          </DialogTitle>
        </DialogHeader>
        {error && <div className="text-sm text-destructive">{error}</div>}
        {!data ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-3 max-h-[70vh] overflow-auto">
            <div className="text-sm text-muted-foreground">
              {data.matchSummary.matchedFlexCount} matched FLEX rows ·{" "}
              {data.matchSummary.recordsWithoutFlex.length} records without FLEX counterpart
            </div>
            <table className="w-full text-sm">
              <thead className="text-left">
                <tr className="border-b">
                  <th className="py-2 pr-3">Symbol</th>
                  <th className="py-2 pr-3">Pay date</th>
                  <th className="py-2 pr-3">RevenueComponent</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3 text-right">Gross USD</th>
                  <th className="py-2 pr-3 text-right">WHT USD</th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="py-1.5 pr-3 font-medium">{r.symbol}</td>
                    <td className="py-1.5 pr-3">{r.payDate}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{r.revenueComponent}</td>
                    <td className="py-1.5 pr-3">
                      <Badge variant={r.taxCategory === "INTEREST" ? "default" : "secondary"}>
                        {r.taxCategory}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {r.grossUsd.toFixed(2)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {r.withholdUsd.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
