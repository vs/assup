/**
 * Historical Data API
 */

import { request } from "./client";
import type { SparklineData, SparklinePoint } from "@assup/shared";

export const historicalApi = {
  getSparkline: (symbol: string) =>
    request<SparklineData>(
      `/api/historical/sparkline/${encodeURIComponent(symbol)}`
    ),

  getBatchSparklines: (symbols: string[]) =>
    request<Record<string, SparklinePoint[]>>("/api/historical/sparklines", {
      method: "POST",
      body: JSON.stringify({ symbols }),
    }),
};
