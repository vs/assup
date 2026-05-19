import { request, buildQuery } from "./client";
import type {
  WheelStrategy,
  WheelStrategyInput,
  WheelStrategyScan,
  WheelStrategyExecuteInput,
} from "@assup/shared";

export const wheelStrategyApi = {
  strategies: {
    list: () =>
      request<WheelStrategy[]>("/api/wheel-strategy"),
    get: (id: string) =>
      request<WheelStrategy & { latestScan: WheelStrategyScan | null }>(
        `/api/wheel-strategy/${id}`,
      ),
    create: (data: WheelStrategyInput) =>
      request<WheelStrategy>("/api/wheel-strategy", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<WheelStrategyInput>) =>
      request<WheelStrategy>(`/api/wheel-strategy/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/api/wheel-strategy/${id}`, {
        method: "DELETE",
      }),
  },
  scans: {
    start: (strategyId: string) =>
      request<{ scanId: string }>(`/api/wheel-strategy/${strategyId}/scan`, {
        method: "POST",
      }),
    list: (strategyId: string, limit = 10) =>
      request<WheelStrategyScan[]>(
        `/api/wheel-strategy/${strategyId}/scans${buildQuery({ limit })}`,
      ),
    get: (scanId: string) =>
      request<WheelStrategyScan>(`/api/wheel-strategy/scans/${scanId}`),
    execute: (scanId: string, data: WheelStrategyExecuteInput) =>
      request<{ orderId: number; symbol: string; action: string; quantity: number }>(
        `/api/wheel-strategy/scans/${scanId}/execute`,
        { method: "POST", body: JSON.stringify(data) },
      ),
  },
};
