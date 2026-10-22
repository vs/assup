import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { gexApi } from "@/api/gex";
import type { GexProfileResponse } from "@assup/shared";

const STALE_TIME = 10 * 60 * 1000; // 10 minutes (backend caches for longer)

export function useGexProfile(symbol: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ["gex-profile", symbol];
  const [refreshing, setRefreshing] = useState(false);

  const query = useQuery<GexProfileResponse>({
    queryKey,
    queryFn: () => gexApi.getProfile(symbol!),
    enabled: !!symbol,
    staleTime: STALE_TIME,
    retry: 1,
  });

  const refresh = useCallback(async () => {
    if (!symbol) return;
    setRefreshing(true);
    try {
      const data = await gexApi.getProfile(symbol, { refresh: true });
      queryClient.setQueryData(["gex-profile", symbol], data);
    } finally {
      setRefreshing(false);
    }
  }, [symbol, queryClient]);

  return { ...query, refresh, refreshing };
}
