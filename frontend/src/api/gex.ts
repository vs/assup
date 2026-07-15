import { request, buildQuery } from "./client";
import type { GexAnalysisResponse } from "@assup/shared";

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
};
