import { request, buildQuery } from "./client";
import type { GexAnalysisResponse, GexProfileResponse } from "@assup/shared";

export const gexApi = {
  getAnalysis: (
    symbol: string,
    options?: { expiration?: string; aggregate?: boolean; refresh?: boolean },
  ) =>
    request<GexAnalysisResponse>(
      `/api/gex/${encodeURIComponent(symbol)}${buildQuery({
        expiration: options?.expiration,
        aggregate: options?.aggregate,
        refresh: options?.refresh,
      })}`,
    ),

  getProfile: (symbol: string, options?: { refresh?: boolean }) =>
    request<GexProfileResponse>(
      `/api/gex/${encodeURIComponent(symbol)}/profile${buildQuery({ refresh: options?.refresh })}`,
    ),
};
