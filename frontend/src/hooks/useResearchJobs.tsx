import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { sseManager } from "./useSSE";
import { researchApi } from "@/api/research";

const COMPLETED_RETENTION_MS = 3000;

export interface ResearchJobState {
  jobId: string;
  symbol: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: string | null;
  error: string | null;
}

interface ResearchJobsContextValue {
  jobs: Map<string, ResearchJobState>;
  getJobForSymbol: (symbol: string) => ResearchJobState | undefined;
  startJob: (symbol: string, jobId: string) => void;
}

const ResearchJobsContext = createContext<ResearchJobsContextValue | null>(null);

// Event emitter for job finished notifications
type FinishedCallback = (symbol: string, status: "completed" | "failed", error?: string | null) => void;
const finishedListeners = new Set<FinishedCallback>();

export function ResearchJobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Map<string, ResearchJobState>>(new Map());
  const retentionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Hydrate from server — fetch all queued/running generate_report jobs
  const hydrate = useCallback(async () => {
    try {
      const activeJobs = await researchApi.listJobs({
        status: ["queued", "running"],
        type: "generate_report",
      });
      setJobs((prev) => {
        const next = new Map(prev);
        for (const job of activeJobs) {
          if (!job.symbol) continue;
          // Only overwrite if we don't have a more recent entry for this symbol
          const existing = next.get(job.symbol);
          if (!existing || existing.status === "completed" || existing.status === "failed") {
            next.set(job.symbol, {
              jobId: job.id,
              symbol: job.symbol,
              status: job.status as ResearchJobState["status"],
              progress: job.progress,
              error: job.error,
            });
          }
        }
        // Remove entries that were active but are no longer in the server response
        for (const [symbol, state] of next) {
          if (state.status === "queued" || state.status === "running") {
            const stillActive = activeJobs.some((j) => j.symbol === symbol);
            if (!stillActive) {
              next.delete(symbol);
            }
          }
        }
        return next;
      });
    } catch (err) {
      console.error("Failed to hydrate research jobs:", err);
    }
  }, []);

  // Hydrate on mount and re-hydrate on tab focus
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate is async (fetch then setState), not synchronous
    hydrate();
    const handleFocus = () => hydrate();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [hydrate]);

  // Subscribe to SSE research_job events
  useEffect(() => {
    const unsubscribe = sseManager.subscribe();
    const removeListener = sseManager.addListener("research_job", (data: unknown) => {
      const event = data as {
        jobId: string;
        symbol: string;
        status: string;
        progress: string | null;
        error: string | null;
      };

      // Track whether we need to notify finished listeners (must happen outside state updater)
      let shouldNotify = false;

      setJobs((prev) => {
        const existing = prev.get(event.symbol);

        // For completed/failed: verify jobId matches to avoid race conditions
        if (event.status === "completed" || event.status === "failed") {
          if (existing && existing.jobId !== event.jobId) {
            return prev; // Ignore stale event from older job
          }

          shouldNotify = true;

          // Keep entry briefly for visual feedback, then remove
          const next = new Map(prev);
          next.set(event.symbol, {
            jobId: event.jobId,
            symbol: event.symbol,
            status: event.status as ResearchJobState["status"],
            progress: event.progress,
            error: event.error,
          });

          // Schedule removal
          const existingTimer = retentionTimers.current.get(event.symbol);
          if (existingTimer) clearTimeout(existingTimer);
          retentionTimers.current.set(
            event.symbol,
            setTimeout(() => {
              setJobs((p) => {
                const n = new Map(p);
                // Only remove if it's still the same completed/failed job
                const current = n.get(event.symbol);
                if (current && current.jobId === event.jobId) {
                  n.delete(event.symbol);
                }
                return n;
              });
              retentionTimers.current.delete(event.symbol);
            }, COMPLETED_RETENTION_MS)
          );

          return next;
        }

        // For queued/running: update directly
        const next = new Map(prev);
        next.set(event.symbol, {
          jobId: event.jobId,
          symbol: event.symbol,
          status: event.status as ResearchJobState["status"],
          progress: event.progress,
          error: event.error,
        });
        return next;
      });

      // Notify finished listeners AFTER the state updater (side effects must not live inside setState)
      if (shouldNotify && (event.status === "completed" || event.status === "failed")) {
        finishedListeners.forEach((cb) =>
          cb(event.symbol, event.status as "completed" | "failed", event.error)
        );
      }
    });

    return () => {
      removeListener();
      unsubscribe();
    };
  }, []);

  // Cleanup retention timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of retentionTimers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const getJobForSymbol = useCallback(
    (symbol: string) => jobs.get(symbol),
    [jobs]
  );

  const startJob = useCallback((symbol: string, jobId: string) => {
    setJobs((prev) => {
      // Guard against double-starts
      const existing = prev.get(symbol);
      if (existing && (existing.status === "queued" || existing.status === "running")) {
        return prev;
      }
      const next = new Map(prev);
      next.set(symbol, {
        jobId,
        symbol,
        status: "queued",
        progress: null,
        error: null,
      });
      return next;
    });
  }, []);

  return (
    <ResearchJobsContext.Provider value={{ jobs, getJobForSymbol, startJob }}>
      {children}
    </ResearchJobsContext.Provider>
  );
}

export function useResearchJobs() {
  const ctx = useContext(ResearchJobsContext);
  if (!ctx) throw new Error("useResearchJobs must be used within ResearchJobsProvider");
  return ctx;
}

/**
 * Dedicated hook that fires a callback when a research job finishes (completed or failed).
 * Follows the useAllocationUpdates/usePositionUpdates callbackRef pattern.
 */
export function useResearchJobFinished(
  callback: (symbol: string, status: "completed" | "failed", error?: string | null) => void
) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    const handler: FinishedCallback = (symbol, status, error) => {
      callbackRef.current(symbol, status, error);
    };
    finishedListeners.add(handler);
    return () => {
      finishedListeners.delete(handler);
    };
  }, []);
}
