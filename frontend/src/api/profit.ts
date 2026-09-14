/**
 * Profit API
 */

import { request, buildQuery } from "./client";
import { getApiBase } from "@/lib/apiConfig";
import type {
  ImportResult,
  ImportListResponse,
  MonthlyProfitResponse,
  MonthDetail,
  MonthProfitView,
  AllPositionsView,
  TickerActivity,
} from "@assup/shared";

interface MonthlyProfitQueryParams {
  startDate?: string;
  endDate?: string;
}

export const profitApi = {
  /**
   * Get available years with profit data
   */
  years: () => request<{ years: number[] }>("/api/profit/years"),

  /**
   * Get the per-ticker realized P&L activity log
   */
  tickerActivity: (symbol: string) =>
    request<TickerActivity>(`/api/profit/ticker/${encodeURIComponent(symbol)}/activity`),

  /**
   * Import a Flex Query file
   */
  import: async (file: File): Promise<ImportResult> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${getApiBase()}/api/profit/import`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Import failed: ${response.statusText}`);
    }

    return response.json();
  },

  /**
   * List all import batches
   */
  imports: {
    list: () => request<ImportListResponse>("/api/profit/imports"),

    delete: (id: string) =>
      request<void>(`/api/profit/imports/${id}`, { method: "DELETE" }),
  },

  /**
   * Get monthly profit summaries
   */
  monthly: (params?: MonthlyProfitQueryParams) => {
    const query = params
      ? buildQuery(params as Record<string, string | number | boolean | undefined>)
      : "";
    return request<MonthlyProfitResponse>(`/api/profit/monthly${query}`);
  },

  /**
   * Get detailed breakdown for a specific month
   */
  monthDetail: (year: number, month: number) =>
    request<MonthDetail>(`/api/profit/month/${year}/${month}`),

  /**
   * Get current month profit with unrealized and projected
   */
  current: () => request<MonthProfitView>("/api/profit/current"),

  /**
   * Get next month profit with unrealized and projected
   */
  next: () => request<MonthProfitView>("/api/profit/next"),

  /**
   * Get all open option positions regardless of expiry month
   */
  positions: () => request<AllPositionsView>("/api/profit/positions"),

  /**
   * Trigger assignment detection
   */
  detectAssignments: () =>
    request<{ assignmentsDetected: number }>("/api/profit/detect-assignments", {
      method: "POST",
    }),
};
