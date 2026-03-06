/**
 * Research API
 */

import { request, buildQuery } from "./client";
import type {
  ResearchReport,
  ResearchJob,
  MacroAnalysis,
  AnalysisSummaryResponse,
  ReportHistoryResponse,
  TickerListResponse,
} from "@assup/shared";

export const researchApi = {
  // Reports
  getReport: (symbol: string) =>
    request<ResearchReport>(`/api/research/${symbol}`),

  getHistory: (symbol: string, page = 1) =>
    request<ReportHistoryResponse>(
      `/api/research/${symbol}/history${buildQuery({ page })}`
    ),

  generate: (symbol: string, options?: { force?: boolean }) =>
    request<{ jobId: string }>(`/api/research/${symbol}/generate`, {
      method: "POST",
      body: JSON.stringify(options || {}),
    }),

  // Analysis
  getAnalysis: (symbol: string) =>
    request<AnalysisSummaryResponse>(`/api/research/${symbol}/analysis`),

  // Macro
  getMacro: () => request<MacroAnalysis>("/api/research/macro"),

  // Tickers
  listTickers: (page = 1, limit = 100) =>
    request<TickerListResponse>(
      `/api/research/tickers${buildQuery({ page, limit })}`
    ),

  // Sync
  syncWatchlist: () =>
    request<{ synced: number; skipped: number }>(
      "/api/research/sync-watchlist",
      {
        method: "POST",
      }
    ),

  // Jobs
  getJob: (jobId: string) =>
    request<ResearchJob>(`/api/research/jobs/${jobId}`),
};
