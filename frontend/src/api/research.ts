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
  CollectionDataResponse,
} from "@assup/shared";

export const researchApi = {
  // Reports
  getReport: (symbol: string) =>
    request<ResearchReport>(`/api/research/${symbol}`),

  getHistory: (symbol: string, page = 1) =>
    request<ReportHistoryResponse>(
      `/api/research/${symbol}/history${buildQuery({ page })}`
    ),

  generate: (symbol: string, options?: { force?: boolean; mode?: string }) =>
    request<{ jobId: string }>(`/api/research/${symbol}/generate`, {
      method: "POST",
      body: JSON.stringify(options || {}),
    }),

  // Analysis
  getAnalysis: (symbol: string) =>
    request<AnalysisSummaryResponse>(`/api/research/${symbol}/analysis`),

  // Macro
  getMacro: () => request<MacroAnalysis>("/api/research/macro"),
  refreshMacro: () =>
    request<MacroAnalysis>("/api/research/macro/refresh", { method: "POST" }),

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

  // Collection data (OHLCV, raw source data)
  getCollectionData: (symbol: string) =>
    request<CollectionDataResponse>(`/api/research/${symbol}/data`),

  // Jobs
  getJob: (jobId: string) =>
    request<ResearchJob>(`/api/research/jobs/${jobId}`),

  // Status
  getClaudeStatus: () =>
    request<{ available: boolean; mode: string; error?: string; keyConfigured?: boolean; keySource?: string }>(
      "/api/research/claude-status"
    ),

  // Auth
  getAuthStatus: () =>
    request<{ configured: boolean; source: string; maskedToken?: string }>(
      "/api/research/auth/status"
    ),

  setAuthToken: (token: string) =>
    request<{ configured: boolean; source: string; maskedToken?: string }>(
      "/api/research/auth/token",
      { method: "PUT", body: JSON.stringify({ token }) }
    ),

  deleteAuthToken: () =>
    request<{ configured: boolean; source: string }>(
      "/api/research/auth/token",
      { method: "DELETE" }
    ),
};
