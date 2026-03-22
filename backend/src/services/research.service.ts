import { AppError } from "../errors/AppError.js";
import type {
  ResearchReport,
  ResearchTicker,
  ResearchJob,
  MacroAnalysis,
  AnalysisSummaryResponse,
  ReportHistoryResponse,
  TickerListResponse,
} from "@assup/shared";

class ResearchService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.RESEARCH_API_URL || "http://localhost:3002";
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await globalThis.fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...options?.headers },
      });
    } catch (err) {
      throw new AppError(
        `Research service unavailable: ${(err as Error).message}`,
        503,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "Unknown error");
      throw new AppError(`Research service error: ${body}`, response.status);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  // Reports
  async getReport(symbol: string): Promise<ResearchReport> {
    return this.fetch<ResearchReport>(`/api/reports/${symbol}`);
  }

  async getReportHistory(
    symbol: string,
    page = 1,
    limit = 20,
  ): Promise<ReportHistoryResponse> {
    return this.fetch<ReportHistoryResponse>(
      `/api/reports/${symbol}/history?page=${page}&limit=${limit}`,
    );
  }

  async generateReport(
    symbol: string,
    options?: { force?: boolean; mode?: string },
  ): Promise<{ jobId: string }> {
    return this.fetch<{ jobId: string }>(
      `/api/reports/${symbol}/generate`,
      {
        method: "POST",
        body: JSON.stringify(options || {}),
      },
    );
  }

  // Analysis
  async getAnalysis(symbol: string): Promise<AnalysisSummaryResponse> {
    return this.fetch<AnalysisSummaryResponse>(`/api/analysis/${symbol}`);
  }

  // Macro
  async getMacro(): Promise<MacroAnalysis> {
    return this.fetch<MacroAnalysis>("/api/macro");
  }

  // Tickers
  async listTickers(page = 1, limit = 100): Promise<TickerListResponse> {
    return this.fetch<TickerListResponse>(
      `/api/tickers?page=${page}&limit=${limit}`,
    );
  }

  async syncTickers(
    symbols: string[],
  ): Promise<{ added: ResearchTicker[]; skipped: string[] }> {
    return this.fetch<{ added: ResearchTicker[]; skipped: string[] }>(
      "/api/tickers",
      {
        method: "POST",
        body: JSON.stringify({ symbols, source: "external" }),
      },
    );
  }

  // Jobs
  async getJob(jobId: string): Promise<ResearchJob> {
    return this.fetch<ResearchJob>(`/api/jobs/${jobId}`);
  }

  // Claude status
  async getClaudeStatus(): Promise<{ available: boolean; mode: string; error?: string }> {
    return this.fetch<{ available: boolean; mode: string; error?: string }>("/api/claude-status");
  }
}

export const researchService = new ResearchService();
