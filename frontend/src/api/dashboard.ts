import type { DashboardPeriod, DashboardSummary, AccountHistoryResponse, AccountHistoryGranularity } from "@assup/shared";
import { request, buildQuery } from "./client";

interface DashboardQueryParams {
  period?: DashboardPeriod;
  year?: number;
}

export const dashboardApi = {
  summary(params?: DashboardQueryParams): Promise<DashboardSummary> {
    const query = buildQuery({
      period: params?.period,
      year: params?.year,
    });
    return request<DashboardSummary>(`/api/dashboard/summary${query}`);
  },

  accountHistory(params?: {
    from?: string;
    to?: string;
    granularity?: AccountHistoryGranularity;
  }): Promise<AccountHistoryResponse> {
    const query = buildQuery({
      from: params?.from,
      to: params?.to,
      granularity: params?.granularity,
    });
    return request<AccountHistoryResponse>(`/api/dashboard/account-history${query}`);
  },
  dailyPnl(): Promise<{ dailyPnL: number; unrealizedPnL: number; realizedPnL: number }> {
    return request<{ dailyPnL: number; unrealizedPnL: number; realizedPnL: number }>("/api/dashboard/daily-pnl");
  },
};
