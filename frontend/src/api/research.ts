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
  CollectionDataResponse,
  MarketScannerPreset,
  ScanCodeInfo,
  MarketScanResult,
  ScanRun,
} from "@assup/shared";

export const researchApi = {
  // Reports
  getReport: (symbol: string) =>
    request<ResearchReport>(`/api/research/${symbol}`),

  getHistory: (symbol: string, page = 1) =>
    request<ReportHistoryResponse>(
      `/api/research/${symbol}/history${buildQuery({ page })}`
    ),

  generate: (symbol: string, options?: { force?: boolean; mode?: string; model?: string }) =>
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

  // Collection data (OHLCV, raw source data)
  getCollectionData: (symbol: string) =>
    request<CollectionDataResponse>(`/api/research/${symbol}/data`),

  // Jobs
  getJob: (jobId: string) =>
    request<ResearchJob>(`/api/research/jobs/${jobId}`),

  listJobs: (params?: { status?: string | string[]; type?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) {
      const statuses = Array.isArray(params.status) ? params.status : [params.status];
      statuses.forEach((s) => query.append("status", s));
    }
    if (params?.type) query.set("type", params.type);
    const qs = query.toString();
    return request<ResearchJob[]>(`/api/research/jobs${qs ? `?${qs}` : ""}`);
  },

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

  // Seeking Alpha Auth
  getSAAuthStatus: () =>
    request<{
      configured: boolean;
      source: string;
      maskedKey?: string;
    }>("/api/research/sa-auth/status"),

  setSAApiKey: (apiKey: string) =>
    request<{ configured: boolean; source: string; maskedKey?: string }>(
      "/api/research/sa-auth/credentials",
      { method: "PUT", body: JSON.stringify({ apiKey }) }
    ),

  deleteSAApiKey: () =>
    request<{ configured: boolean; source: string }>(
      "/api/research/sa-auth/credentials",
      { method: "DELETE" }
    ),

  testSAConnection: () =>
    request<{ ok: boolean; hasData: boolean }>(
      "/api/research/sa-auth/test",
      { method: "POST" }
    ),

  // Reddit Auth
  getRedditAuthStatus: () =>
    request<{
      configured: boolean;
      source: string;
      maskedClientId?: string;
    }>("/api/research/reddit-auth/status"),

  setRedditCredentials: (clientId: string, clientSecret: string) =>
    request<{ configured: boolean; source: string; maskedClientId?: string }>(
      "/api/research/reddit-auth/credentials",
      { method: "PUT", body: JSON.stringify({ clientId, clientSecret }) }
    ),

  deleteRedditCredentials: () =>
    request<{ configured: boolean; source: string }>(
      "/api/research/reddit-auth/credentials",
      { method: "DELETE" }
    ),

  testRedditConnection: () =>
    request<{ ok: boolean; hasData: boolean; error?: string }>(
      "/api/research/reddit-auth/test",
      { method: "POST" }
    ),

  // Market Scanner
  listScannerPresets: () =>
    request<MarketScannerPreset[]>("/api/research/scanner/presets"),

  createScannerPreset: (data: Omit<MarketScannerPreset, "id" | "lastRun">) =>
    request<MarketScannerPreset>("/api/research/scanner/presets", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateScannerPreset: (id: string, data: Partial<MarketScannerPreset>) =>
    request<MarketScannerPreset>(`/api/research/scanner/presets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteScannerPreset: (id: string) =>
    request<void>(`/api/research/scanner/presets/${id}`, { method: "DELETE" }),

  runScannerPreset: (id: string) =>
    request<{ jobId: string }>(`/api/research/scanner/presets/${id}/run`, { method: "POST" }),

  runAdhocScan: (params: Record<string, unknown>) =>
    request<MarketScanResult>("/api/research/scanner/scan", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  getScanCodes: () =>
    request<ScanCodeInfo[]>("/api/research/scanner/scan-codes"),

  getScannerResults: (page = 1, limit = 20) =>
    request<{ tickers: Array<{ symbol: string; addedAt: string; status: string }>; total: number }>(
      `/api/research/scanner/results${buildQuery({ page, limit })}`
    ),

  // Scan Runs
  listScanRuns: () =>
    request<ScanRun[]>("/api/research/scanner/runs"),

  deleteScanRun: (id: string) =>
    request<void>(`/api/research/scanner/runs/${id}`, { method: "DELETE" }),
};
