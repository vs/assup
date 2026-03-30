/**
 * Wheel Scanner API
 */

import { request, buildQuery } from "./client";
import type { WheelScanConfig, WheelScan } from "@assup/shared";

export interface WheelScanConfigInput {
  assetClassId: string;
  searchKeywords: string[];
  seedTickers: string[];
  minPrice?: number;
  maxPrice?: number;
  minMarketCap?: number;
  enabled?: boolean;
}

export const wheelScannerApi = {
  configs: {
    list: () => request<WheelScanConfig[]>("/api/wheel-scanner/configs"),
    upsert: (data: WheelScanConfigInput) =>
      request<WheelScanConfig>("/api/wheel-scanner/configs", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/api/wheel-scanner/configs/${id}`, {
        method: "DELETE",
      }),
  },
  scans: {
    start: () =>
      request<{ scanId: string }>("/api/wheel-scanner/scan", {
        method: "POST",
      }),
    list: (limit = 10) =>
      request<WheelScan[]>(
        `/api/wheel-scanner/scans${buildQuery({ limit })}`
      ),
    get: (id: string) =>
      request<WheelScan>(`/api/wheel-scanner/scans/${id}`),
  },
};
