/**
 * useScanJobs - manages scanner job state with SSE updates
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";
import { getApiBase } from "@/lib/apiConfig";
import type { ScanJob, ScanJobCreateInput } from "@assup/shared";

interface ScanJobEvent {
  type: "created" | "progress" | "completed" | "failed" | "cancelled";
  job?: ScanJob;
  jobId?: string;
  scannedSymbols?: number;
  totalSymbols?: number;
  opportunityCount?: number;
  symbol?: string;
  assetClass?: string;
  error?: string;
}

export function useScanJobs() {
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial jobs
  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.scanner.jobs.list();
      setJobs(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  // Create a new job
  const createJob = useCallback(async (input: ScanJobCreateInput): Promise<ScanJob> => {
    const job = await api.scanner.jobs.create(input);
    // Optimistically add to list (will be updated via SSE)
    setJobs((prev) => [job, ...prev]);
    return job;
  }, []);

  // Cancel a job
  const cancelJob = useCallback(async (jobId: string): Promise<void> => {
    const updatedJob = await api.scanner.jobs.cancel(jobId);
    setJobs((prev) => prev.map((j) => (j.id === jobId ? updatedJob : j)));
  }, []);

  // Delete a job
  const deleteJob = useCallback(async (jobId: string): Promise<void> => {
    await api.scanner.jobs.delete(jobId);
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  // Handle SSE events
  useEffect(() => {
    const eventSource = new EventSource(`${getApiBase()}/api/updates/stream`);

    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type !== "scanner_job") return;

        const data = message.data as ScanJobEvent;

        switch (data.type) {
          case "created":
            if (data.job) {
              setJobs((prev) => {
                // Avoid duplicates if optimistic add already happened
                if (prev.some((j) => j.id === data.job!.id)) {
                  return prev;
                }
                return [data.job!, ...prev];
              });
            }
            break;

          case "progress":
            if (data.jobId) {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === data.jobId
                    ? {
                        ...j,
                        scannedSymbols: data.scannedSymbols ?? j.scannedSymbols,
                        totalSymbols: data.totalSymbols ?? j.totalSymbols,
                        opportunityCount: data.opportunityCount ?? j.opportunityCount,
                      }
                    : j
                )
              );
            }
            break;

          case "completed":
          case "cancelled":
            if (data.job) {
              setJobs((prev) => prev.map((j) => (j.id === data.job!.id ? data.job! : j)));
            }
            break;

          case "failed":
            if (data.jobId) {
              setJobs((prev) =>
                prev.map((j) =>
                  j.id === data.jobId
                    ? { ...j, status: "failed" as const, errorMessage: data.error || "Unknown error" }
                    : j
                )
              );
            }
            break;
        }
      } catch (err) {
        console.error("Failed to parse SSE message:", err);
      }
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Load jobs on mount and window focus
  useEffect(() => {
    loadJobs();

    const handleFocus = () => loadJobs();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadJobs]);

  return {
    jobs,
    loading,
    error,
    createJob,
    cancelJob,
    deleteJob,
    refreshJobs: loadJobs,
  };
}
