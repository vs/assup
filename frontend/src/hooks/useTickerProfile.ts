// frontend/src/hooks/useTickerProfile.ts

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { tickerProfileApi } from "../api/tickerProfile";
import type { TickerProfileResponse } from "@assup/shared";

const QUERY_KEY_PREFIX = "tickerProfile";
const STALE_TIME = 5 * 60 * 1000; // 5 minutes

export function useTickerProfile(symbol: string | null) {
  return useQuery<TickerProfileResponse>({
    queryKey: [QUERY_KEY_PREFIX, symbol],
    queryFn: () => tickerProfileApi.getProfile(symbol!),
    enabled: !!symbol,
    staleTime: STALE_TIME,
    retry: 1,
  });
}

export function usePrefetchTickerProfiles() {
  const queryClient = useQueryClient();

  const prefetch = useCallback(
    async (symbols: string[]) => {
      const uncached = symbols.filter((s) => {
        const existing = queryClient.getQueryData<TickerProfileResponse>([
          QUERY_KEY_PREFIX,
          s.toUpperCase(),
        ]);
        return !existing;
      });

      if (uncached.length === 0) return;

      const chunks: string[][] = [];
      for (let i = 0; i < uncached.length; i += 50) {
        chunks.push(uncached.slice(i, i + 50));
      }

      for (const chunk of chunks) {
        try {
          const profiles = await tickerProfileApi.getBatchProfiles(chunk);
          for (const [symbol, profile] of Object.entries(profiles)) {
            queryClient.setQueryData(
              [QUERY_KEY_PREFIX, symbol],
              profile
            );
          }
        } catch (err) {
          console.warn("Ticker profile prefetch failed:", err);
        }
      }
    },
    [queryClient]
  );

  return prefetch;
}
