import type {
  FlexWebConfig,
  FlexFetchLogsResponse,
  FlexFetchResult,
} from "@assup/shared";
import { request } from "./client";

export const flexWebApi = {
  config: {
    get: () => request<FlexWebConfig>("/api/flex-web/config"),
    update: (config: FlexWebConfig) =>
      request<{ success: boolean }>("/api/flex-web/config", {
        method: "PUT",
        body: JSON.stringify(config),
        headers: { "Content-Type": "application/json" },
      }),
  },
  fetch: () =>
    request<FlexFetchResult>("/api/flex-web/fetch", { method: "POST" }),
  logs: (page = 1, limit = 20) =>
    request<FlexFetchLogsResponse>(
      `/api/flex-web/log?page=${page}&limit=${limit}`
    ),
};
