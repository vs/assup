/**
 * useActiveScanJobCount - lightweight hook that tracks the number of running scanner jobs
 * via SSE events, for use in navigation badges.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";
import { sseManager } from "./useSSE";
import type { ScanJob } from "@assup/shared";

interface ScanJobEvent {
  type: "created" | "progress" | "completed" | "failed" | "cancelled";
  job?: ScanJob;
  jobId?: string;
}

export function useActiveScanJobCount(): number {
  const [count, setCount] = useState(0);

  const loadCount = useCallback(() => {
    api.scanner.jobs
      .list()
      .then((jobs) => setCount(jobs.filter((j) => j.status === "running").length))
      .catch(() => {
        // Silently ignore - badge is non-critical
      });
  }, []);

  useEffect(() => {
    loadCount();

    const handleFocus = () => loadCount();
    window.addEventListener("focus", handleFocus);

    const removeListener = sseManager.addListener("scanner_job", (rawData) => {
      const data = rawData as ScanJobEvent;
      switch (data.type) {
        case "created":
          if (data.job?.status === "running") {
            setCount((prev) => prev + 1);
          }
          break;
        case "completed":
        case "failed":
        case "cancelled":
          setCount((prev) => Math.max(0, prev - 1));
          break;
      }
    });

    return () => {
      window.removeEventListener("focus", handleFocus);
      removeListener();
    };
  }, [loadCount]);

  return count;
}
