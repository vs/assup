export interface FlexScheduleConfig {
  days: number[];       // 0=Sun, 1=Mon, ..., 6=Sat
  hour: number;         // 0-23
  minute: number;       // 0-59
  repeatHours?: number; // null/undefined = once daily, N = every N hours on selected days
}

export interface FlexWebConfig {
  token: string;
  queryId: string;
  schedule: FlexScheduleConfig;
  enabled: boolean;
}

export interface FlexFetchLogEntry {
  id: string;
  triggeredBy: "schedule" | "manual";
  status: "success" | "error" | "no_new_data";
  startedAt: string;
  completedAt: string | null;
  recordCount: number | null;
  error: string | null;
  importBatchId: string | null;
  details: Record<string, number> | null;
}

export interface FlexFetchLogsResponse {
  logs: FlexFetchLogEntry[];
  total: number;
}

export interface FlexFetchResult {
  status: "success" | "error" | "no_new_data";
  recordCount?: number;
  error?: string;
  details?: Record<string, number>;
}
