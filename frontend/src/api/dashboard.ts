import type { DashboardPeriod, DashboardSummary } from "@assup/shared";
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
};
