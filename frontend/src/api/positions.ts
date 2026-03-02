/**
 * Positions API
 */

import { request, buildQuery } from "./client";
import type { Position, PositionSummary, OptionsWeightMode } from "@assup/shared";

interface PositionSummaryOptions {
  includeOptions?: boolean;
  optionsWeightMode?: OptionsWeightMode;
}

export const positionsApi = {
  list: () => request<Position[]>("/api/positions"),

  summary: (options?: PositionSummaryOptions) => {
    const query = buildQuery({
      includeOptions: options?.includeOptions,
      optionsWeightMode: options?.optionsWeightMode,
    });
    return request<PositionSummary>(`/api/positions/summary${query}`);
  },
};
