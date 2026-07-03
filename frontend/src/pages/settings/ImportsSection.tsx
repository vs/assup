import { Fragment, useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, RefreshCw, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { ImportDialog } from "@/components/profit/ImportDialog";
import { api } from "@/api";
import { flexWebApi } from "@/api/flex-web";
import type { ImportBatch, FlexScheduleConfig } from "@assup/shared";

// ---------------------------------------------------------------------------
// Schedule helpers
// ---------------------------------------------------------------------------

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const DEFAULT_SCHEDULE: FlexScheduleConfig = {
  days: [2, 3, 4, 5, 6],
  hour: 6,
  minute: 0,
};

function describeSchedule(s: FlexScheduleConfig): string {
  if (s.days.length === 0) return "";
  const dayNames = DAYS.filter((d) => s.days.includes(d.value)).map((d) => d.label);
  const time = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;
  const dayStr = dayNames.length === 7 ? "daily" : dayNames.join(", ");
  if (s.repeatHours) {
    return `Every ${s.repeatHours}h starting at ${time} ET, ${dayStr}`;
  }
  return `At ${time} ET, ${dayStr}`;
}

// ---------------------------------------------------------------------------
// Status / duration helpers
// ---------------------------------------------------------------------------

type FetchStatus = "success" | "error" | "no_new_data";

function StatusBadge({ status }: { status: FetchStatus }) {
  if (status === "success") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200">success</Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200">error</Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-muted-foreground">no new data</Badge>
  );
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ImportsSection() {
  // --- Manual import state ---
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [importsLoading, setImportsLoading] = useState(true);
  const [importsError, setImportsError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const loadImports = useCallback(async () => {
    try {
      setImportsLoading(true);
      const result = await api.profit.imports.list();
      setImports(result.imports);
      setImportsError(null);
    } catch (err) {
      setImportsError(err instanceof Error ? err.message : "Failed to load imports");
    } finally {
      setImportsLoading(false);
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
    } catch {
      // ignore
    }
  };

  // --- Auto-import config state ---
  const [token, setToken] = useState("");
  const [queryId, setQueryId] = useState("");
  const [schedule, setSchedule] = useState<FlexScheduleConfig>(DEFAULT_SCHEDULE);
  const [enabled, setEnabled] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"once" | "repeat">("once");

  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  // --- Fetch log state ---
  const [logPage, setLogPage] = useState(1);

  const configQuery = useQuery({
    queryKey: ["flex-web", "config"],
    queryFn: () => flexWebApi.config.get(),
    staleTime: 30_000,
  });

  if (configQuery.data && !configLoaded) {
    const cfg = configQuery.data;
    setToken(cfg.token ?? "");
    setQueryId(cfg.queryId ?? "");
    const s = cfg.schedule ?? DEFAULT_SCHEDULE;
    setSchedule(s);
    setRepeatMode(s.repeatHours ? "repeat" : "once");
    setEnabled(cfg.enabled ?? false);
    setConfigLoaded(true);
  }

  const logsQuery = useQuery({
    queryKey: ["flex-web", "logs", logPage],
    queryFn: () => flexWebApi.logs(logPage),
    staleTime: 10_000,
  });

  const logs = logsQuery.data?.logs ?? [];
  const logTotal = logsQuery.data?.total ?? 0;
  const logTotalPages = Math.max(1, Math.ceil(logTotal / 20));

  const toggleDay = (day: number) => {
    setSchedule((prev) => ({
      ...prev,
      days: prev.days.includes(day)
        ? prev.days.filter((d) => d !== day)
        : [...prev.days, day],
    }));
  };

  const handleSave = async () => {
    if (schedule.days.length === 0) {
      setOpError("Select at least one day");
      return;
    }
    setSaving(true);
    setSaveSuccess(false);
    setOpError(null);
    try {
      const scheduleToSave: FlexScheduleConfig = {
        ...schedule,
        repeatHours: repeatMode === "repeat" ? (schedule.repeatHours || 4) : undefined,
      };
      await flexWebApi.config.update({ token, queryId, schedule: scheduleToSave, enabled });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setSaving(false);
    }
  };

  const handleFetchNow = async () => {
    setFetching(true);
    setFetchResult(null);
    setOpError(null);
    try {
      const result = await flexWebApi.fetch();
      if (result.status === "success") {
        setFetchResult(`Fetched — ${result.recordCount ?? 0} records imported`);
        loadImports(); // refresh import history too
      } else if (result.status === "no_new_data") {
        setFetchResult("No new data available");
      } else {
        setOpError(result.error ?? "Fetch returned an error");
      }
      logsQuery.refetch();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setFetching(false);
    }
  };

  const canFetch = token.trim().length > 0 && queryId.trim().length > 0;
  const scheduleHint = describeSchedule(
    repeatMode === "repeat"
      ? { ...schedule, repeatHours: schedule.repeatHours || 4 }
      : { ...schedule, repeatHours: undefined }
  );

  if (importsLoading && imports.length === 0 && !configLoaded) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6 py-2">
      {importsError && <ErrorAlert message={importsError} onDismiss={() => setImportsError(null)} />}
      {opError && <ErrorAlert message={opError} onDismiss={() => setOpError(null)} />}

      {/* Auto-Import Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Auto-Import (FLEX Web Service)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="flex-token">Token</Label>
              <div className="flex gap-2">
                <Input
                  id="flex-token"
                  type={showToken ? "text" : "password"}
                  placeholder="FLEX Web Service token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? "Hide token" : "Show token"}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="flex-query-id">Query ID</Label>
              <Input
                id="flex-query-id"
                type="text"
                placeholder="e.g. 123456"
                value={queryId}
                onChange={(e) => setQueryId(e.target.value)}
              />
            </div>
          </div>

          {/* Schedule */}
          <div className="space-y-3">
            <Label>Schedule</Label>
            <div className="flex gap-1.5">
              {DAYS.map((day) => {
                const active = schedule.days.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-input hover:bg-accent"
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Label className="text-sm text-muted-foreground">at</Label>
                <Select
                  value={String(schedule.hour)}
                  onValueChange={(v) => setSchedule((prev) => ({ ...prev, hour: Number(v) }))}
                >
                  <SelectTrigger className="w-[70px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {String(i).padStart(2, "0")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">:</span>
                <Select
                  value={String(schedule.minute)}
                  onValueChange={(v) => setSchedule((prev) => ({ ...prev, minute: Number(v) }))}
                >
                  <SelectTrigger className="w-[70px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 15, 30, 45].map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {String(m).padStart(2, "0")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">ET</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRepeatMode("once")}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                    repeatMode === "once"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-input hover:bg-accent"
                  }`}
                >
                  Once daily
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRepeatMode("repeat");
                    if (!schedule.repeatHours) setSchedule((prev) => ({ ...prev, repeatHours: 4 }));
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                    repeatMode === "repeat"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-input hover:bg-accent"
                  }`}
                >
                  Repeat
                </button>
                {repeatMode === "repeat" && (
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm text-muted-foreground">every</Label>
                    <Select
                      value={String(schedule.repeatHours || 4)}
                      onValueChange={(v) => setSchedule((prev) => ({ ...prev, repeatHours: Number(v) }))}
                    >
                      <SelectTrigger className="w-[70px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 6, 8, 12].map((h) => (
                          <SelectItem key={h} value={String(h)}>
                            {h}h
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            {scheduleHint && (
              <p className="text-sm text-muted-foreground">{scheduleHint}</p>
            )}
          </div>

          {/* Enable + actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Switch id="flex-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="flex-enabled">
                {enabled ? "Enabled" : "Disabled"}
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleFetchNow} disabled={fetching || !canFetch}>
                {fetching && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
                {fetching ? "Fetching..." : "Fetch Now"}
              </Button>
              {saveSuccess && <span className="text-sm text-green-600">Saved</span>}
              {fetchResult && <span className="text-sm text-green-600">{fetchResult}</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Combined Import History (manual + auto) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              Import History
              <Badge variant="secondary">{imports.length}</Badge>
            </CardTitle>
            <Button onClick={() => setImportDialogOpen(true)}>Import File</Button>
          </div>
        </CardHeader>
        <CardContent>
          {imports.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No imports yet. Upload a FLEX report or use auto-import above.
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
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(imp.id)}>
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

      {/* Fetch Log (auto-import runs) */}
      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                Fetch Log
                {logTotal > 0 && <Badge variant="secondary">{logTotal}</Badge>}
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => logsQuery.refetch()}
                disabled={logsQuery.isFetching}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${logsQuery.isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date / Time</TableHead>
                  <TableHead>Triggered by</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((entry) => (
                  <Fragment key={entry.id}>
                    <TableRow>
                      <TableCell className="font-mono text-sm">
                        {new Date(entry.startedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{entry.triggeredBy}</Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={entry.status} />
                      </TableCell>
                      <TableCell className="text-right">{entry.recordCount ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {formatDuration(entry.startedAt, entry.completedAt)}
                      </TableCell>
                    </TableRow>
                    {entry.error && (
                      <TableRow className="bg-muted/50">
                        <TableCell colSpan={5} className="text-xs text-muted-foreground font-mono py-1 pl-4">
                          {entry.error}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>

            {logTotalPages > 1 && (
              <div className="flex items-center justify-end gap-2 mt-4">
                <Button variant="outline" size="sm" disabled={logPage <= 1} onClick={() => setLogPage((p) => Math.max(1, p - 1))}>
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">{logPage} / {logTotalPages}</span>
                <Button variant="outline" size="sm" disabled={logPage >= logTotalPages} onClick={() => setLogPage((p) => Math.min(logTotalPages, p + 1))}>
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImportComplete={handleImportComplete}
      />
    </div>
  );
}
