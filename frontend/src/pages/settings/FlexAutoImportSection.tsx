import { Fragment, useState } from "react";
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
import { ErrorAlert, PageLoadingSkeleton } from "@/components/common";
import { Link } from "react-router-dom";
import { flexWebApi } from "@/api/flex-web";
import type { FlexWebConfig } from "@assup/shared";

// ---------------------------------------------------------------------------
// Cron description helper (no external library)
// ---------------------------------------------------------------------------

const DAY_NAMES: Record<string, string> = {
  "0": "Sun",
  "1": "Mon",
  "2": "Tue",
  "3": "Wed",
  "4": "Thu",
  "5": "Fri",
  "6": "Sat",
};

function describeCronSchedule(cron: string): string {
  if (!cron.trim()) return "";
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return "Custom schedule";

  const [minute, hour, , , dayOfWeek] = parts;

  // Only describe simple "at HH:MM" patterns
  const minuteNum = parseInt(minute, 10);
  const hourNum = parseInt(hour, 10);
  if (
    isNaN(minuteNum) ||
    isNaN(hourNum) ||
    minuteNum < 0 ||
    minuteNum > 59 ||
    hourNum < 0 ||
    hourNum > 23
  ) {
    return "Custom schedule";
  }

  const timeStr = `${String(hourNum).padStart(2, "0")}:${String(minuteNum).padStart(2, "0")}`;

  // Parse day-of-week
  let dayStr = "";
  if (dayOfWeek === "*") {
    dayStr = "daily";
  } else {
    // Handle range like "1-5", "2-6", or list like "1,2,3"
    const rangeMatch = dayOfWeek.match(/^(\d)-(\d)$/);
    if (rangeMatch) {
      const start = rangeMatch[1];
      const end = rangeMatch[2];
      const startName = DAY_NAMES[start];
      const endName = DAY_NAMES[end];
      if (startName && endName) {
        dayStr = `${startName}-${endName}`;
      } else {
        return "Custom schedule";
      }
    } else {
      // Try comma-separated list
      const days = dayOfWeek.split(",");
      const names = days.map((d) => DAY_NAMES[d.trim()]).filter(Boolean);
      if (names.length === days.length) {
        dayStr = names.join(", ");
      } else {
        return "Custom schedule";
      }
    }
  }

  return dayStr === "daily"
    ? `At ${timeStr} ET, daily`
    : `At ${timeStr} ET, ${dayStr}`;
}

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

type FetchStatus = "success" | "error" | "no_new_data";

function StatusBadge({ status }: { status: FetchStatus }) {
  if (status === "success") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200">
        success
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200">error</Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-muted-foreground">
      no new data
    </Badge>
  );
}

function TriggeredBadge({ by }: { by: "schedule" | "manual" }) {
  return (
    <Badge variant="outline" className="text-xs">
      {by}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Duration formatting
// ---------------------------------------------------------------------------

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FlexAutoImportSection() {
  // Config form state
  const [token, setToken] = useState("");
  const [queryId, setQueryId] = useState("");
  const [schedule, setSchedule] = useState("0 6 * * 2-6");
  const [enabled, setEnabled] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Operation state
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  // Pagination for log
  const [page, setPage] = useState(1);

  // Load config
  const configQuery = useQuery({
    queryKey: ["flex-web", "config"],
    queryFn: () => flexWebApi.config.get(),
    staleTime: 30_000,
  });

  // Populate form once config loads
  if (configQuery.data && !configLoaded) {
    const cfg: FlexWebConfig = configQuery.data;
    setToken(cfg.token ?? "");
    setQueryId(cfg.queryId ?? "");
    setSchedule(cfg.schedule ?? "0 6 * * 2-6");
    setEnabled(cfg.enabled ?? false);
    setConfigLoaded(true);
  }

  // Log query
  const logsQuery = useQuery({
    queryKey: ["flex-web", "logs", page],
    queryFn: () => flexWebApi.logs(page),
    staleTime: 10_000,
  });

  const logs = logsQuery.data?.logs ?? [];
  const total = logsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  // Handlers
  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setOpError(null);
    try {
      await flexWebApi.config.update({ token, queryId, schedule, enabled });
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
        setFetchResult(
          `Fetched successfully — ${result.recordCount ?? 0} records imported`
        );
      } else if (result.status === "no_new_data") {
        setFetchResult("No new data available");
      } else {
        setOpError(result.error ?? "Fetch returned an error");
      }
      // Refresh logs after fetch
      logsQuery.refetch();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setFetching(false);
    }
  };

  const canFetch = token.trim().length > 0 && queryId.trim().length > 0;
  const cronHint = describeCronSchedule(schedule);

  if (configQuery.isLoading && !configLoaded) {
    return <PageLoadingSkeleton />;
  }

  return (
    <div className="space-y-6 py-2">
      <h2 className="text-lg font-semibold">FLEX Auto-Import</h2>

      {opError && (
        <ErrorAlert message={opError} onDismiss={() => setOpError(null)} />
      )}

      {configQuery.error && !configLoaded && (
        <ErrorAlert
          message={
            configQuery.error instanceof Error
              ? configQuery.error.message
              : "Failed to load config"
          }
          onDismiss={() => configQuery.refetch()}
        />
      )}

      {/* Config form */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="flex-token">FLEX Web Service Token</Label>
            <div className="flex gap-2">
              <Input
                id="flex-token"
                type={showToken ? "text" : "password"}
                placeholder="Enter your IBKR FLEX Web Service token"
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
                {showToken ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="flex-query-id">Query ID</Label>
            <Input
              id="flex-query-id"
              type="text"
              placeholder="IBKR FLEX Query ID (e.g. 123456)"
              value={queryId}
              onChange={(e) => setQueryId(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="flex-schedule">Cron Schedule</Label>
            <Input
              id="flex-schedule"
              type="text"
              placeholder="0 6 * * 2-6"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
            />
            {cronHint && (
              <p className="text-sm text-muted-foreground">{cronHint}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="flex-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            <Label htmlFor="flex-enabled">
              {enabled ? "Scheduled fetching enabled" : "Scheduled fetching disabled"}
            </Label>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button
              variant="outline"
              onClick={handleFetchNow}
              disabled={fetching || !canFetch}
            >
              {fetching ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {fetching ? "Fetching..." : "Fetch Now"}
            </Button>
            {saveSuccess && (
              <span className="text-sm text-green-600">Saved</span>
            )}
            {fetchResult && (
              <span className="text-sm text-green-600">{fetchResult}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Fetch log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              Fetch Log
              {total > 0 && <Badge variant="secondary">{total}</Badge>}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => logsQuery.refetch()}
              disabled={logsQuery.isFetching}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${logsQuery.isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {logsQuery.error && (
            <p className="text-sm text-destructive py-2">
              Failed to load logs
            </p>
          )}
          {logs.length === 0 && !logsQuery.isLoading ? (
            <p className="text-muted-foreground text-center py-8">
              No fetch history yet. Run "Fetch Now" or wait for the scheduled
              fetch.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date / Time</TableHead>
                    <TableHead>Triggered by</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead></TableHead>
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
                          <TriggeredBadge by={entry.triggeredBy} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={entry.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          {entry.recordCount ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatDuration(entry.startedAt, entry.completedAt)}
                        </TableCell>
                        <TableCell>
                          {entry.importBatchId && (
                            <Link
                              to="/settings/imports"
                              className="text-xs text-primary underline-offset-4 hover:underline"
                            >
                              View import
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                      {entry.error && (
                        <TableRow className="bg-muted/50">
                          <TableCell
                            colSpan={6}
                            className="text-xs text-muted-foreground font-mono py-1 pl-4"
                          >
                            {entry.error}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-end gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
