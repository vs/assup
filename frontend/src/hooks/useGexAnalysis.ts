import { useQuery } from "@tanstack/react-query";
import { gexApi } from "@/api/gex";
import type { GexAnalysisResponse } from "@assup/shared";

const STALE_TIME = 10 * 60 * 1000; // 10 minutes (backend caches for longer)

export function useGexAnalysis(
  symbol: string | null,
  options?: { expiration?: string; aggregate?: boolean; refresh?: boolean },
) {
  const enabled = !!symbol;
  const queryKey = ["gex", symbol, options?.expiration ?? null, options?.aggregate ?? false];

  return useQuery<GexAnalysisResponse>({
    queryKey,
    queryFn: () => gexApi.getAnalysis(symbol!, options),
    enabled,
    staleTime: STALE_TIME,
    retry: 1,
  });
}
