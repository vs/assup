/**
 * ScanJobList - displays list of scan jobs with real-time updates
 */

import type { ScanJob } from "@assup/shared";
import { ScanJobRow } from "./ScanJobRow";
import type { ExtendedOptionOpportunity } from "./types";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface ScanJobListProps {
  jobs: ScanJob[];
  onCancel: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onClearAll: () => void;
  onSellClick: (opportunity: ExtendedOptionOpportunity) => void;
}

export function ScanJobList({
  jobs,
  onCancel,
  onDelete,
  onClearAll,
  onSellClick,
}: ScanJobListProps) {
  if (jobs.length === 0) {
    return null;
  }

  const completedJobs = jobs.filter(
    (j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled"
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Scan Jobs</h3>
        {completedJobs.length > 1 && (
          <Button variant="outline" size="sm" onClick={onClearAll}>
            <X className="h-4 w-4 mr-2" />
            Clear Completed
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {jobs.map((job) => (
          <ScanJobRow
            key={job.id}
            job={job}
            onCancel={onCancel}
            onDelete={onDelete}
            onSellClick={onSellClick}
          />
        ))}
      </div>
    </div>
  );
}
