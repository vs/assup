/**
 * Settings API
 */

import { request } from "./client";
import type { DashboardSettings } from "@assup/shared";

export const settingsApi = {
  get: <T>(key: string) => request<{ key: string; value: T }>(`/api/settings/${key}`),

  set: <T>(key: string, value: T) =>
    request<{ key: string; value: T }>(`/api/settings/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),

  getDashboard: () =>
    settingsApi.get<DashboardSettings>("dashboard").then((r) => r.value),

  setDashboard: (value: DashboardSettings) =>
    settingsApi.set<DashboardSettings>("dashboard", value).then((r) => r.value),
};
