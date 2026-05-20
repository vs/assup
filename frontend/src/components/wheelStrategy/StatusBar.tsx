import { useState, useEffect } from "react";
import type { WheelStrategy, WheelStrategyScan, WheelStrategyProgress } from "@assup/shared";
import { sseManager } from "@/hooks/useSSE";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { timeAgo } from "@/utils/format";

interface StatusBarProps {
  strategy: WheelStrategy;
  scans: WheelStrategyScan[];
  activeScanId: string | null;
  onScanComplete: () => void;
}

const phaseLabels: Record<string, string> = {
  discovery: "Discovery",
  fundamentals: "Fundamentals",
  earnings: "Earnings",
  contracts: "Contracts",
  ranking: "Ranking",
  completed: "Completed",
};

const statusStyles: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Pending", variant: "outline" },
  running: { label: "Running", variant: "default" },
  completed: { label: "Completed", variant: "secondary" },
  failed: { label: "Failed", variant: "destructive" },
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StatusBar({ strategy, scans, activeScanId, onScanComplete }: StatusBarProps) {
  const [progress, setProgress] = useState<WheelStrategyProgress | null>(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  const [expandedScanId, setExpandedScanId] = useState<string | null>(null);

  // Reset progress when active scan changes
  useEffect(() => {
    if (!activeScanId) {
      setProgress(null);
      return;
    }

    const remove = sseManager.addListener("wheel_strategy", (rawData) => {
      const data = rawData as WheelStrategyProgress;
      if (data.scanId !== activeScanId) return;
      setProgress(data);
      if (data.phase === "completed") {
        onScanComplete();
      }
    });

    return remove;
  }, [activeScanId, onScanComplete]);

  // Schedule info
  function renderScheduleInfo() {
    let scheduleText: string;
    if (strategy.intervalHours != null) {
      scheduleText = `Every ${strategy.intervalHours}h (market hours)`;
    } else if (strategy.cronExpression) {
      scheduleText = strategy.cronExpression;
    } else {
      scheduleText = "Manual only";
    }

    const parts: string[] = [scheduleText];
    if (strategy.nextRunAt) {
      parts.push(`Next: ${formatDate(strategy.nextRunAt)}`);
    }
    if (strategy.lastRunAt) {
      parts.push(`Last: ${timeAgo(strategy.lastRunAt)}`);
    }

    return (
      <p className="text-xs text-muted-foreground">
        {parts.join(" · ")}
      </p>
    );
  }

  // Progress bar for active scan
  function renderProgress() {
    if (!activeScanId) return null;

    const phaseLabel = progress ? (phaseLabels[progress.phase] ?? progress.phase) : "Starting...";
    const progressPct =
      progress && progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
    const isIndeterminate = !progress || progress.total === 0;

    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{phaseLabel}</span>
          {progress && progress.total > 0 && (
            <span>
              {progress.current} / {progress.total}
            </span>
          )}
        </div>
        <Progress
          value={isIndeterminate ? undefined : progressPct}
          className="h-1.5"
        />
      </div>
    );
  }

  // Scan history section
  function renderHistory() {
    if (scans.length === 0) return null;

    return (
      <div className="border-t pt-2">
        <button
          className="w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setHistoryCollapsed(!historyCollapsed)}
        >
          <History className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">
            Scan History
          </span>
          <span>
            ({scans.length} scan{scans.length !== 1 ? "s" : ""})
          </span>
          <span className="ml-auto">
            {historyCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </span>
        </button>

        {!historyCollapsed && (
          <div className="mt-1 space-y-0.5">
            {scans.map((scan) => {
              const style = statusStyles[scan.status] ?? statusStyles.pending;
              const isExpanded = expandedScanId === scan.id;

              return (
                <div key={scan.id}>
                  <button
                    className="w-full flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50 transition-colors text-xs"
                    onClick={() => setExpandedScanId(isExpanded ? null : scan.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-muted-foreground">
                      {timeAgo(scan.createdAt)}
                    </span>
                    <Badge variant={style.variant} className="text-xs h-4 px-1">
                      {style.label}
                    </Badge>
                    <span className="text-muted-foreground">
                      {scan.processedCandidates} processed / {scan.totalCandidates} found
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="px-4 py-1 text-xs text-muted-foreground space-y-0.5">
                      {scan.startedAt && (
                        <div>Started: {formatDate(scan.startedAt)}</div>
                      )}
                      {scan.completedAt && (
                        <div>Completed: {formatDate(scan.completedAt)}</div>
                      )}
                      {scan.cspResults && scan.cspResults.length > 0 && (
                        <div>{scan.cspResults.length} CSP result{scan.cspResults.length !== 1 ? "s" : ""}</div>
                      )}
                      {scan.ccResults && scan.ccResults.length > 0 && (
                        <div>{scan.ccResults.length} CC result{scan.ccResults.length !== 1 ? "s" : ""}</div>
                      )}
                      {scan.errorMessage && (
                        <div className="text-destructive">{scan.errorMessage}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {renderScheduleInfo()}
      {renderProgress()}
      {renderHistory()}
    </div>
  );
}
