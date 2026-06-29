/**
 * ScanJobRow - displays a single scan job with expand/collapse
 */

import { useState, useEffect } from "react";
import type { ScanJob } from "@assup/shared";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { GroupedResultsTable, type TickerCostBasis } from "./GroupedResultsTable";
import type { ExtendedOptionOpportunity } from "./types";
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  X,
  Square,
} from "lucide-react";

interface ScanJobRowProps {
  job: ScanJob;
  onCancel: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onSellClick: (opportunity: ExtendedOptionOpportunity) => void;
  costBasisMap?: Map<string, TickerCostBasis>;
}

export function ScanJobRow({ job, onCancel, onDelete, onSellClick, costBasisMap }: ScanJobRowProps) {
  const [expanded, setExpanded] = useState(
    job.status === "running" || job.opportunities.length > 0
  );

  // Auto-expand when first results arrive during a running scan
  const hasOpportunities = job.opportunities.length > 0;
  useEffect(() => {
    if (job.status === "running" && hasOpportunities) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time expansion on first results, not a cascading render
      setExpanded(true);
    }
  }, [hasOpportunities, job.status]);

  const isRunning = job.status === "running";
  const isCompleted = job.status === "completed";
  const isFailed = job.status === "failed";

  const progressPercent =
    job.totalSymbols > 0 ? Math.round((job.scannedSymbols / job.totalSymbols) * 100) : 0;

  const StatusIcon = isRunning
    ? Loader2
    : isCompleted
      ? CheckCircle2
      : isFailed
        ? XCircle
        : AlertCircle;

  const statusColor = isRunning
    ? "text-blue-500"
    : isCompleted
      ? "text-green-500"
      : isFailed
        ? "text-red-500"
        : "text-yellow-500";

  // Format the scan target description
  const getScanTarget = () => {
    if (job.criteria.specificSymbol) {
      return job.criteria.specificSymbol;
    }
    if (job.criteria.targetAssetClasses && job.criteria.targetAssetClasses.length > 0) {
      // We don't have asset class names here, just IDs - show count
      const count = job.criteria.targetAssetClasses.length;
      return `${count} asset class${count > 1 ? "es" : ""}`;
    }
    return "All symbols";
  };

  // Format the start time
  const formatStartTime = () => {
    const date = new Date(job.startedAt);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Opportunities now include underlyingPrice from backend
  const extendedOpportunities: ExtendedOptionOpportunity[] = job.opportunities.map((opp) => ({
    ...opp,
    underlyingPrice: opp.underlyingPrice,
  }));

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header row */}
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors",
          expanded && "bg-muted/30"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Expand/collapse chevron */}
        <div className="text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>

        {/* Status icon */}
        <StatusIcon
          className={cn("h-5 w-5", statusColor, isRunning && "animate-spin")}
        />

        {/* Job title: time + target */}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">
            {formatStartTime()} · {getScanTarget()}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {job.presetName}
          </div>
        </div>

        {/* Progress (if running) */}
        {isRunning && job.totalSymbols > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {job.scannedSymbols}/{job.totalSymbols}
            </span>
            <Progress value={progressPercent} className="w-20 h-2" />
          </div>
        )}

        {/* Stats badges */}
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{job.opportunityCount} opportunities</Badge>
          {job.bestAnnualReturn && (
            <Badge variant="outline" className="text-green-600">
              {job.bestAnnualReturn.toFixed(1)}% best
            </Badge>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {isRunning ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCancel(job.id)}
              title="Cancel scan"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(job.id)}
              title="Delete job"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Error message (if failed) */}
      {isFailed && job.errorMessage && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 text-sm">
          Error: {job.errorMessage}
        </div>
      )}

      {/* Expanded results */}
      {expanded && job.opportunities.length > 0 && (
        <div className="border-t">
          <GroupedResultsTable
            opportunities={extendedOpportunities}
            onSellClick={onSellClick}
            costBasisMap={costBasisMap}
          />
        </div>
      )}

      {/* No results message */}
      {expanded && job.opportunities.length === 0 && !isRunning && (
        <div className="border-t px-4 py-8 text-center text-muted-foreground">
          No opportunities found matching criteria
        </div>
      )}
    </div>
  );
}
